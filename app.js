/*
## How I got IR working
First, I followed this tutorial: peppe8o.com/setup-raspberry-pi-infrared-remote-from-terminal
I'm not *quite* following the tutorial above. Instead I'm reading from the IR-Keytable device directly and NOT remapping to standard keys.
Then I followed this tutorial to run a script as a service at startup: thedigitalpictureframe.com/ultimate-guide-systemd-autostart-scripts-raspberry-pi

To identify what /dev/input device to use, you can use # ls -l /dev/input to list all devices, and # ir-keytable to see what IR devices are available.

To restart the service run:
sudo systemctl restart node-ir-server.service

View all IR inputs by running:
sudo ir-keytable -v -t -p rc-5,rc-5-sz,jvc,sony,nec,sanyo,mce_kbd,rc-6,sharp,xmp

*/

console.log('node-ir-server service started!');

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
    this.lastBufferLoopEvent = 0;
    this.standardLoopSpeed = 125; // default loop speed.
    this.loopSpeed = this.standardLoopSpeed; // variable loop speed
    this.repeatCount = 0;
  }

  /*
    TBA
    keycode:
    irRepeatTightness:
    remoteName:
    self: False if originated from an actual ir-remote, true of triggered by the rawInput function (buffer loop system).
  */
  rawInput(keycode, irRepeatTightness, remoteName, bufferLoop) {
    // Log the event.
    // console.log(Date.now() + ': ' + keycode + 'called from ' + remoteName + ' with buffer length of ' + irRepeatTightness + 'ms with bufferloop = ' + bufferLoop);

    // Was this from an actual input? Or just a looped event?
    if (bufferLoop === false) { // Actual input
      console.log('🔵 IR input');
      var stop = false;

      // Are we within the gap window?
      if (Date.now() < this.lastKeyEvent.time + (this.loopSpeed) ) {
        stop = true; // We're within a gap of the last IR event. Don't actually send an API call.
      } else {
        // Continue on and trigger the buffer loop.
        // console.log('invoking buffer loop from IR event');
        let self = this;
        setTimeout(function () {
          self.rawInput(keycode, irRepeatTightness, remoteName, true);
        }, this.loopSpeed);
      }

      // Record this as the most recent keyEvent
      this.lastKeyEvent = {
        time: Date.now(),
        code: keycode
      }

      if (stop) {
        console.log('🟠 Stopping.')
        return;
      }
    } // end 'bufferLoop === false' if statement.

    // Double bufferLoop prevention
    if(bufferLoop === true) {
      if(this.lastBufferLoopEvent > (Date.now() - this.loopSpeed + 5)) {
        console.log('🔴 DOUBLE BUFFER LOOP DETECTED AND STOPPED.');
        return;
      }
      this.lastBufferLoopEvent = Date.now();
    }

    // Buffer loop.
    if (bufferLoop === true && Date.now() < this.lastKeyEvent.time + this.loopSpeed - irRepeatTightness) {
      console.log('🟣 Buffer Loop Retrigger: ' + this.repeatCount);
      console.log('🟣 IR Repeat Tightness: ' + this.irRepeatTightness);

      if (this.repeatCount > 10) {
        this.loopSpeed = this.loopSpeed * .7; // Long press? Change volume faster.
        console.log('🏎 fast repeat mode enabled');
      } else if (this.loopSpeed !== this.standardLoopSpeed) {
        this.loopSpeed = this.standardLoopSpeed;
      }

      let repeatDelay = this.loopSpeed;
      

      let self = this;
      setTimeout(function () {
        self.rawInput(keycode, irRepeatTightness, remoteName, true);
      }, repeatDelay);

      this.repeatCount++;

    } else if (bufferLoop === true){
      this.repeatCount = 0;
      return;
    } else {
      this.repeatCount = 0;
    }

    console.log('🟢 ' + Date.now() + ': Running with invocation from bufferloop = ' + bufferLoop);
    // Otherwise, carry on and send the API call.
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
    systemBuffer: 0,
    volumeUp: 753,
    volumeDown: 754,
    volumeMute: 752
  },
  lgRemote: {
    systemBuffer: 0,
    volumeUp: 31258,
    volumeDown: 31259,
    volumeMute: 31260
  },
  sonyRemote: {
    systemBuffer: 25, // this thing repeats so fast that we need to account for it.
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
    // console.log(buffer); // Log *everything* Useful for discovering IR keycodes

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
