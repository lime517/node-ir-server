/*
## How I got IR working
First, I followed this tutorial: peppe8o.com/setup-raspberry-pi-infrared-remote-from-terminal
I'm not *quite* following the tutorial above. Instead I'm reading from the IR-Keytable device directly and NOT remapping to standard keys.
Then I followed this tutorial to run a script as a service at startup: thedigitalpictureframe.com/ultimate-guide-systemd-autostart-scripts-raspberry-pi

To identify what /dev/input device to use, you can use # ls -l /dev/input to list all devices, and # ir-keytable to see what IR devices are available.

To restart the service run:
sudo systemctl restart node-ir-server.service

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
    this.lastKeyEvent = {
      time: 0,
      code: 0
    }
    this.loopSpeed = 100
  }

  /*
    TBA
    keycode:
    bufferLength:
    remoteName:
    self: False if originated from an actual ir-remote, true of triggered by the rawInput function (buffer loop system).
  */
  rawInput(keycode, bufferLength, remoteName, bufferLoop) {
    // Log the event.
    console.log(Date.now() + ': ' + keycode + 'called from ' + remoteName + ' with buffer length of ' + bufferLength + 'ms');

    // Record this as the most recent keyEvent
    if (bufferLoop === false) {
      this.lastKeyEvent = {
        time: Date.now(),
        code: keycode
      }
    }

    // Was this a self-triggered buffer-loop event?
    if (bufferLoop === true) {
      // should this run?
      if (Date.now() > this.lastKeyEvent.time + this.loopSpeed) {
        return; // stop.
      }
    }

    // First, Check if this is a fast duplicate. 90ms is impossibly fast for a human to double-tap.
    // if (Date.now() < this.lastNewKeypress + bufferLength) {
    //   console.log("Event blocked", Date.now(), this.lastNewKeypress);
    //   return; // do nothing. Just straight up ignore this.
    // } else {
    //   console.log("Event allowed", Date.now(), this.lastNewKeypress);
    // }

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

    // Buffer loop.
    let self = this;
    setTimeout(self.rawInput(keycode, bufferLength, remoteName, true), this.loopSpeed);
  }

  apiRequest(endpoint, keycode, callback) {
    let request = axios.get(this.apiBase + endpoint);
    return request;
  }

  apiResponseCallback(keycode) {
    console.log("Successful request");
  }

  mute() {
    const self = this;
    this.apiRequest("Volume").then(function (response) {
      const isMuted =
        parser.parse(response.data).volume.mute == "1" ? true : false;

      if (isMuted) {
        self.apiRequest("Volume?mute=0");
      } else {
        self.apiRequest("Volume?mute=1");
      }
    });
  }

  volumeChange(direction) {
    let amount = 0;
    if (direction == "up") {
      amount = 1;
    } else if (direction == "down") {
      amount = -1;
    }
    this.apiRequest("Volume?db=" + amount).then(function (response) {
      //console.log('volume adjusted');
    });
  }
}

let irController = new irControllerSystem();

const remotes = {
  chromeCastRemote: {
    systemBuffer: 90,
    volumeUp: 753,
    volumeDown: 754,
    volumeMute: 752
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
            irController.rawInput(subKey, remote.systemBuffer, key, false);
          }
        });
      });

    }
  });
}
