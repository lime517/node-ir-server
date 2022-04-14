// var http = require('http');
// var server = http.createServer(function (request, response) { response.writeHead(200, { "Content-Type": "text/plain" });
// response.end("Hi Kaitie!\n"); }); server.listen(8000);
// console.log("Server running at http://127.0.0.1:8000/");

/*
input-event attempt - HELL YES IT WORKS! :D
To identify what /dev/input device to use, you can use # ls -l /dev/input to list all devices, and # ir-keytable to see what IR devices are available.

Other remote keycodes (for LG OLED)
Volume Up   = 1026
Volume Up   = 1027
Mute        = 1033
Input       = 1035
Power       = 1032
*/

const { XMLParser, XMLBuilder, XMLValidator} = require("../src/fxp");

const parser = new XMLParser();

// Our controller that passes on HTTP requests, etc
class irControllerSystem {
  constructor() {
    this.lastNewKeypress = 0;
    this.apiBase = "http://m10.local:11000/";
    this.currentMuteState = 0;
  }

  rawInput(keycode) {
    // First, Check if this is a fast duplicate. 15ms is impossibly fast for a human to double-tap.
    if (Date.now() < this.lastNewKeypress + 15) {
      return; // do nothing. Just straight up ignore this.
    }

    // Otherwise, carry on.
    switch (keycode) {
      case "mute":
        this.mute();
        break;
      default:
        console.log("No function bound to input " + keycode);
    }
  }

  apiRequest(endpoint, keycode, callback) {
    let request = new XMLHttpRequest();
    request.addEventListener("load", callback(keycode));
    request.open("GET", this.apiBase + endpoint);
    request.send();
    return request;
  }

  apiResponseCallback(keycode) {
    console.log("Succesful request");
  }

  mute() {
    console.log("mute function called");
    this.currentMuteState = this.apiRequest("Volume");
    this.apiRequest("/");
  }
}

let irController = new irControllerSystem();

// Testing
irController.rawInput("mute");

// Do Stuff on input
const noIr = true; // local dev?
if (noIr === false) {
  const InputEvent = require("input-event");
  const input = new InputEvent("/dev/input/event4");

  const keyboard = new InputEvent.Keyboard(input);

  keyboard.on("data", function (buffer) {
    console.log(buffer); // Log *everything*

    // Volume up
    if (buffer.type === 4 && buffer.code === 4 && buffer.value === 1026) {
      //console.log('VOLUME UP CONTINUOUS');
    }

    // Volume down
    if (buffer.type === 4 && buffer.code === 4 && buffer.value === 1027) {
      //console.log('VOLUME UP CONTINUOUS');
    }

    // Mute
    if (buffer.type === 4 && buffer.code === 4 && buffer.value === 1033) {
      irController.rawInput("mute");
    }
  });
}
