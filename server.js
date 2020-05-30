require("dotenv").config();
var sslRedirect = require("heroku-ssl-redirect");
// Get twillio auth and SID from heroku if deployed, else get from local .env file
var twillioAuthToken =
  process.env.HEROKU_AUTH_TOKEN || process.env.LOCAL_AUTH_TOKEN;
var twillioAccountSID =
  process.env.HEROKU_TWILLIO_SID || process.env.LOCAL_TWILLIO_SID;
var twilio = require("twilio")(twillioAccountSID, twillioAuthToken);
var express = require("express");
var app = express();
const fs = require('fs');
var http = require("https").createServer({
  key: fs.readFileSync('/Users/khushjammu/certs/privkey.pem'),
  cert: fs.readFileSync('/Users/khushjammu/certs/cert.pem')
}, app);
var io = require("socket.io")(http);
var path = require("path");
var public = path.join(__dirname, "public");
const url = require("url");

// enable ssl redirect
app.use(sslRedirect());

// Remove trailing slashes in url
app.use(function (req, res, next) {
  if (req.path.substr(-1) === "/" && req.path.length > 1) {
    let query = req.url.slice(req.path.length);
    res.redirect(301, req.path.slice(0, -1) + query);
  } else {
    next();
  }
});

app.get("/", function (req, res) {
  res.sendFile(path.join(public, "landing.html"));
});

app.get("/newcall", function (req, res) {
  res.sendFile(path.join(public, "newcall.html"));
});

app.get("/join/", function (req, res) {
  res.redirect("/");
});

app.get("/join/*", function (req, res) {
  if (Object.keys(req.query).length > 0) {
    logIt("redirect:" + req.url + " to " + url.parse(req.url).pathname);
    res.redirect(url.parse(req.url).pathname);
  } else {
    res.sendFile(path.join(public, "chat.html"));
  }
});

app.get("/notsupported", function (req, res) {
  res.sendFile(path.join(public, "notsupported.html"));
});

app.get("/notsupportedios", function (req, res) {
  res.sendFile(path.join(public, "notsupportedios.html"));
});

// Serve static files in the public directory
app.use(express.static("public"));

// Simple logging function to add room name
function logIt(msg, room) {
  if (room) {
    console.log(room + ": " + msg);
  } else {
    console.log(msg);
  }
}

// When a socket connects, set up the specific listeners we will use.
io.on("connection", function (socket) {

  socket.on("joinRoom", function (room, uuid) {
    logIt("A client is joining room", room);    
    socket.join(room);
    // tell all in room to identify themselves to uuid
    socket.broadcast.to(room).emit("pleaseIdentify", uuid);
  });

  socket.on("identify", function (room, uuid) {
    logIt("A client is identifying to a room", room);    
    socket.broadcast.to(room).emit("registerPeer", uuid);
  });

  // When a client tries to join a room, only allow them if they are first or
  // second in the room. Otherwise it is full.
  socket.on("joinCall", function (room, uuid) {
    logIt("A client is joining call", room);
    var clients = io.sockets.adapter.rooms[room];
    var numClients = typeof clients !== "undefined" ? clients.length : 0;
    if (numClients === 5) {
      logIt("room already full", room);
      socket.emit("full", room);
    } else {
      // When the client is second to join the room, both clients are ready.
      logIt("Broadcasting ready message", room);
      // First to join call initiates call
      socket.broadcast.to(room).emit("willInitiateCall", room);
      socket.emit("ready", room, uuid).to(room);
      socket.broadcast.to(room).emit("ready", room, uuid);
    }
  });


  // When receiving the token message, use the Twilio REST API to request an
  // token to get ephemeral credentials to use the TURN server.
  socket.on("token", function (room, uuid) {
    logIt("Received token request", room);
    twilio.tokens.create(function (err, response) {
      if (err) {
        logIt(err, room);
      } else {
        logIt("Token generated. Returning it to the browser client", room);
        socket.emit("token", response, uuid).to(room);
      }
    });
  });

  // Relay candidate messages
  socket.on("candidate", function (candidate, room, uuid) {
    logIt("Received candidate. Broadcasting...", room);
    socket.broadcast.to(room).emit("candidate", candidate, uuid);
  });

  // Relay offers
  socket.on("offer", function (offer, room, uuid) {
    logIt("Received offer. Broadcasting...", room);
    socket.broadcast.to(room).emit("offer", offer, uuid);
  });

  // Relay answers
  socket.on("answer", function (answer, room, uuid) {
    logIt("Received answer. Broadcasting...", room);
    socket.broadcast.to(room).emit("answer", answer, uuid);
  });
});

// Listen for Heroku port, otherwise just use 3000
var port = process.env.PORT || 443;
http.listen(port, function () {
  console.log("http://localhost:" + port);
});
