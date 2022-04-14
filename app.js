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

// Utilities
const { XMLParser, XMLBuilder, XMLValidator } = require("fast-xml-parser");
const parser = new XMLParser({
  attributeNamePrefix: "",
  attrNodeName: "attr", //default is 'false'
  textNodeName: "text",
  ignoreAttributes: false,
  ignoreNameSpace: false,
  allowBooleanAttributes: true,
});
const axios = require("axios").default;

// Our controller that passes on HTTP requests, etc
class irControllerSystem {
  constructor() {
    this.lastNewKeypress = 0;
    this.apiBase = "http://m10.local:11000/";
    this.currentMuteState = 0;
  }

  rawInput(keycode) {
    // First, Check if this is a fast duplicate. 90ms is impossibly fast for a human to double-tap.
    if (Date.now() < this.lastNewKeypress + 90) {
      console.log("skipping", Date.now(), this.lastNewKeypress);
      return; // do nothing. Just straight up ignore this.
    } else {
      console.log("happening", Date.now(), this.lastNewKeypress);
    }

    // Otherwise, carry on.
    switch (keycode) {
      case "mute":
        this.mute();
        break;
      case "volumeUp":
        this.volumeChange("up");
        break;
      case "volumeDown":
        this.volumeChange("down");
        break;
      default:
        console.log("No function bound to input " + keycode);
    }

    this.lastNewKeypress = Date.now();
  }

  apiRequest(endpoint, keycode, callback) {
    let request = axios.get(this.apiBase + endpoint);
    return request;
  }

  apiResponseCallback(keycode) {
    console.log("Succesful request");
  }

  mute() {
    console.log("mute function called");
    const self = this;
    this.apiRequest("Volume").then(function (response) {
      const isMuted =
        parser.parse(response.data).volume.mute == "1" ? true : false;
      console.log(isMuted);

      if (isMuted) {
        self.apiRequest("Volume?mute=0");
      } else {
        self.apiRequest("Volume?mute=1");
      }
    });
  }

  volumeChange(direction) {
    console.log("Volume " + direction + " Change Called");
    let amount = 0;
    if (direction == "up") {
      amount = 1;
    } else if (direction == "down") {
      amount = -1;
    }
    this.apiRequest("Volume?db=" + amount).then(function (response) {
      console.log('volume adjusted');
    });
    // console.log(this.currentMuteState);
    // this.apiRequest("/");
  }
}

let irController = new irControllerSystem();

// Testing
//irController.rawInput("mute");

// Do Stuff on input
const noIr = false; // local dev?
if (noIr === false) {
  const InputEvent = require("input-event");
  const input = new InputEvent("/dev/input/event4");

  const keyboard = new InputEvent.Keyboard(input);

  keyboard.on("data", function (buffer) {
    console.log(buffer); // Log *everything*

    // Volume up
    if (buffer.type === 4 && buffer.code === 4 && buffer.value === 1026) {
        irController.rawInput("volumeUp");
    }

    // Volume down
    if (buffer.type === 4 && buffer.code === 4 && buffer.value === 1027) {
        irController.rawInput("volumeDown");
    }

    // Mute
    if (buffer.type === 4 && buffer.code === 4 && buffer.value === 1033) {
      irController.rawInput("mute");
    }
  });
}
