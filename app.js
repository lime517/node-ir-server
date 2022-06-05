/*
## How I got IR working
First, I followed this tutorial: peppe8o.com/setup-raspberry-pi-infrared-remote-from-terminal
I'm not *quite* following the tutorial above. Instead I'm reading from the IR-Keytable device directly and NOT remapping to standard keys.
Then I followed this tutorial to run a script as a service at startup: thedigitalpictureframe.com/ultimate-guide-systemd-autostart-scripts-raspberry-pi

To identify what /dev/input device to use, you can use # ls -l /dev/input to list all devices, and # ir-keytable to see what IR devices are available.

To restart the service, run:


// KEYCODES

Chromecast set to Denon Receiver:
Volume Up   = 1026
Volume Down = 1027
Mute        = 1033
Input       = 1035
Power       = 1032

Yamaha/LG Generic Universal Remote:
Sony 4k Player:
Volume Up   = 31258
Volume Down = 31259
Mute        = 31260

Sony 4k Player:
Volume Up   = 65554
Volume Down = 65555
Mute        = 65556

// I'm not actually using any of the below. Instead I'm reading from the IR-Keytable device directly and not remapping to standard keys.
Chromecast set to Denon Receiver:
Volume Up: lirc protocol(nec): scancode = 0x402
Volume Down: lirc protocol(nec): scancode = 0x403
Mute: lirc protocol(nec): scancode = 0x409

Yamaha/LG Generic Universal Remote
Volume Up: lirc protocol(nec): scancode = 0x7a1b
Volume Down: lirc protocol(nec): scancode = 0x7a1b
Mute: lirc protocol(nec): scancode = 0x7a1c

Sony 4k Player:
Up: lirc protocol(sony12): scancode = 0x10012
Down: lirc protocol(sony12): scancode = 0x10013
Mute: lirc protocol(sony12): scancode = 0x10014
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

  rawInput(keycode, bufferLength, remoteName) {
    // First, Check if this is a fast duplicate. 90ms is impossibly fast for a human to double-tap.
    if (Date.now() < this.lastNewKeypress + bufferLength) {
      console.log("Event blocked", Date.now(), this.lastNewKeypress);
      return; // do nothing. Just straight up ignore this.
    } else {
      console.log("Event allowed", Date.now(), this.lastNewKeypress);
    }

    // Otherwise, carry on.
    switch (keycode) {
      case "volumeMute":
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

    console.log(Date.now() + ': ' + keycode + 'called from ' + remoteName + ' with buffer length of ' + bufferLength + 'ms');
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
    //console.log("Volume " + direction + " Change Called");
    let amount = 0;
    if (direction == "up") {
      amount = 1;
    } else if (direction == "down") {
      amount = -1;
    }
    this.apiRequest("Volume?db=" + amount).then(function (response) {
      //console.log('volume adjusted');
    });
    // console.log(this.currentMuteState);
    // this.apiRequest("/");
  }
}

let irController = new irControllerSystem();

const remotes = {
  chromeCastRemote: {
    systemBuffer: 90,
    volumeUp: 1026,
    volumeDown: 1027,
    volumeMute: 1033
  },
  lgRemote: {
    systemBuffer: 90,
    volumeUp: 31258,
    volumeDown: 31259,
    volumeMute: 31260
  },
  sonyRemote: {
    systemBuffer: 125,
    volumeUp: 65554,
    volumeDown: 65555,
    volumeMute: 65556
  },
}

// Do Stuff on input
const noIr = false; // local dev?
if (noIr === false) {
  const InputEvent = require("input-event");
  const input = new InputEvent("/dev/input/event0");

  const keyboard = new InputEvent.Keyboard(input);

  keyboard.on("data", function (buffer) {
    //console.log(buffer); // Log *everything* Useful for discovering IR keycodes

    // Set up inputs. 
    if (buffer.type === 4 && buffer.code === 4) {
      Object.keys(remotes).forEach(key => {
        Object.keys(remotes[key]).forEach(subKey => {
          var remote = remotes[key];
          if (remote[subKey] === buffer.value) {
            irController.rawInput(subKey, remote.systemBuffer, key);
          }
        });
      });

    }
  });
}
