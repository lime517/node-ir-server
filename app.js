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
const events = require('events');

const yargs = require('yargs');
let argv = yargs
  .option('logAllIrEvents', {
    alias: 'i',
    default: false,
  }).argv;

// Our controller that passes on HTTP requests, etc
class irControllerSystem {
  constructor(lgtvcontrol = true) {
    this.lastNewKeypress = 0;
    this.apiBase = "http://m10.local:11000/";
    this.lgtvcontrol = lgtvcontrol; // Control an LG TV directly (Input switching) as well?
    this.eventEmitter = new events.EventEmitter();
    this.currentMuteState = 0;
    this.lastKeyEvent = {
      time: 0,
      code: 0
    }
    this.lastBufferLoopEvent = 0;
    this.standardLoopSpeed = 125; // default loop speed.
    this.loopSpeed = this.standardLoopSpeed; // variable loop speed
    this.repeatCount = 0;
    this.linuxRemotes = { // Keycodes for all of our remotes
      chromeCastRemote: {
        systemBuffer: 0,
        volumeUp: 753,
        volumeDown: 754,
        volumeMute: 752
      },
      lgRemote: {
        systemBuffer: 75,
        volumeUp: 31258,
        volumeDown: 31259,
        volumeMute: 31260
      },
      sonyRemote: {
        systemBuffer: 200, // Delay starting repeat commands (holding down a button) by 200ms
        volumeUp: 65554,
        volumeDown: 65555,
        volumeMute: 65556
      },
      appleRemote: { // At least, the Apple remote while connected to our LG CX
        systemBuffer: 100, // Delay starting repeat commands (holding down a button) by 200ms
        volumeUp: 1026,
        volumeDown: 1027,
        volumeMute: 1033
      }
    }
    this.macRemote = { // Our "Mac" (keyboard) remote
      systemBuffer: 0,
      volumeUp: 'up',
      volumeDown: 'down',
      volumeMute: 'm',
      deviceinput: 'q',
      arrowleft: 'a',
      arrowright: 'd',
      ok: 's'
    }
    this.secretCodes = { // You know the konami code? Well this is like that, when you put in the inputs quickly enough, inputs will have different outputs for the activationDuration
      inputSwitcher: {
        inputs: [ // The magic input code to go into this mode
          'volumeUp',
          'volumeDown',
          'volumeUp'
        ],
        onActivation: 'deviceinput', // What to do the moment our input keys have been entered correctly
        activatedKeys: { // When the secret code mode is activated, what should our keys do?
          'volumeUp': 'arrowright',
          'volumeDown': 'arrowleft',
          'volumeMute': 'ok',
        },
        currentProgress: 0,
        escapeKey: 'volumeMute', // Break out of the secret mode
        onEscape: false,
        gap: 1200, // in ms, the maximum amount of time between keypresses allowed.
        activationDuration: 0, // in ms, how long to keep ourselves in the "secret code" mode after it's been activated. 0 for no limit.
        onTimeout: 'back', // the key to be pressed on timeout, or false
        activationTimestamp: 0,
        isActive: false
      }
    }
    this.tvConnected = false;
    this.setupLgtv(this.eventEmitter);

    // Attempt to connect to the TV if it's not already connected
    this.eventEmitter.on('tvCommand', (command) => {
      if (this.tvConnected === false) {
        this.setupLgtv(this.eventEmitter);
      }
    });
  }

  setupLgtv(eventEmitter) {
    if (!this.lgtvcontrol) {
      return; // LG TV Control is not enabled, abandon.
    }

    // LG TV Control
    const LGTV = require("lgtv-ip-control").LGTV;

    // IP Address, MAC address (wireless), and IP Codes. See here for docs: https://www.npmjs.com/package/lgtv-ip-control
    const tv = new LGTV('192.168.1.115', '60:8D:26:36:E2:3A', 'Q66CQKS9');

    tv.connect()
      .then(async () => {
        console.log('LG TV Connected.');
        this.tvConnected = true;
        // await tv.sendKey('deviceinput'); // device input switcher
        // await tv.setVolumeMute(false);
        // console.log('Setting volume to 15...');
        // await tv.setVolume(15);
        // console.log('Done!');
        eventEmitter.on('tvCommand', (command) => {
          console.log("📺 LG TV Key: " + command + " being sent.");
          tv.sendKey(command);
        });
      })
      .catch((error) => {
        console.log('❌ LG TV failed to connect.');
        console.log(error);
        this.tvConnected = false;
      });

    return tv;
  }

  // Run on any "Real" (physically entered, not system repeated) input.
  secretCodeEntry(keycode) {
    let returnable = false;

    // Secret Code Listener. Loop through all of our secretCode options first.
    for (const [index, code] of Object.entries(this.secretCodes)) {

      // Is this secret code mode already active? 
      if (code.isActive === true) {
        console.log('🕹 🟢 Secret Code: ' + index + ' is currently active.');
        // SHOULD it be active? 
        if (Date.now() >= code.activationTimestamp + code.activationDuration && code.activationDuration !== 0) {
          this.secretCodes[index].isActive = false;
          if (code.onTimeout) {
            returnable = code.onTimeout;
          }
          console.log('🕹 🔴 Secret Code: ' + index + ' deactivated, maximum time met.');
        }

        // Remap keys as necessary
        for (const [inputKey, remappedKey] of Object.entries(code.activatedKeys)) {
          if (inputKey === keycode) {
            returnable = remappedKey;
          }
        }

        // Is the key we selected the "Escape" key?
        if (keycode === code.escapeKey) {
          this.secretCodes[index].isActive = false;
          console.log('🕹 🏁 Secret Code: ' + index + ' deactivated, escape key entered.');

          if (code.onEscape) {
            this.triggerEvent(code.onEscape, false);
          }
        }

        break; // We should never progress secret modes while one is active.
      }

      // Does the key we entered match the expected key to continue this secret code?
      if (keycode === code.inputs[code.currentProgress]) {

        // Are we within the specified gap?
        if (Date.now() >= this.lastKeyEvent.time + code.gap) {
          console.log('🕹 Secret Code: ' + index + ' depth reset to zero, as the maximum key-gap was passed.')
          this.secretCodes[index].currentProgress = 0;
        }

        this.secretCodes[index].currentProgress++; // Increase our progress counter
        console.log('🕹 Secret Code: ' + index + ' progressed to depth ' + this.secretCodes[index].currentProgress + ' out of ' + code.inputs.length + '.')

        // Did we complete the entry code?
        if (this.secretCodes[index].currentProgress === code.inputs.length) {
          // Begin an abandonment timer.
          this.secretCodes[index].activationTimestamp = Date.now();
          this.secretCodes[index].currentProgress = 0; // Reset to zero since we've now activated the mode
          this.secretCodes[index].isActive = true;
          console.log('🕹 🟢 Secret Code: ' + index + ' activated. Returning ' + code.onActivation + ' command.');
          // Do the initial command by changing the current keycode, also making sure we *DON'T* do the command this key would normally perform.
          returnable = code.onActivation;

          // // Also set a timeout, if necessary.
          // if(code.activationDuration !== 0) {
          //   setTimeout(() => {
          //     console.log('timeout running');
          //     if(Date.now() + this.secretCodes[index].activationDuration >= this.secretCodes[index].activationTimestamp) {
          //       this.triggerEvent(code.onTimeout, false);
          //       console.log('🕹 🔴 Secret Code: ' + index + ' deactivated, maximum time met.');
          //     }
          //   }, code.activationDuration)
          // }
          continue;
        }

      } else if (this.secretCodes[index].currentProgress !== 0) { // Broke progress, reset to 0 and abandon.
        console.log('🕹 Secret Code: ' + index + ' reset progress to 0 from ' + this.secretCodes[index].currentProgress + '.');
        this.secretCodes[index].currentProgress = 0; // reset progress to 0.
        continue;
      }
    }

    // If the returnable was set, return it, otherwise, return unmodified.
    if (returnable !== false) {
      return returnable;
    } else {
      return keycode;
    }
  }

  /*
    keycode: the keycode of the input
    irRepeatDelay: how much to delay repeat commands (holding down a button)
    remoteName: the name of the remote that originated the event
    self: False if originated from an actual ir-remote, true of triggered by the rawInput function (buffer loop system).
  */
  rawInput(keycode, irRepeatDelay, remoteName, bufferLoop) {
    // Log the event.
    // console.log(Date.now() + ': ' + keycode + 'called from ' + remoteName + ' with buffer length of ' + irRepeatDelay + 'ms with bufferloop = ' + bufferLoop);

    // Was this from an actual input? Or just a looped event?
    if (bufferLoop === false) { // Actual input
      console.log('🔵 Input Event from ' + remoteName);
      var stop = false;

      // Are we within the gap window?
      if (Date.now() < this.lastKeyEvent.time + (this.loopSpeed)) {
        stop = true; // We're within a gap of the last IR event. Don't actually send an API call.
      } else {
        // Continue on and trigger the buffer loop.
        // console.log('invoking buffer loop from IR event');
        let self = this;
        setTimeout(function () {
          self.rawInput(keycode, irRepeatDelay, remoteName, true);
        }, this.loopSpeed + irRepeatDelay);
      }

      if (stop) {
        console.log('🟠 Stopping.')
        return; // End bufferloop.
      }

      // Try to progress any secret code entries (Konami style). 
      // We pass in the current keycode, and if it needs to be something different, we change the keycode to the one returned.
      keycode = this.secretCodeEntry(keycode);

      // Record this as the most recent keyEvent
      this.lastKeyEvent = {
        time: Date.now(),
        code: keycode
      }

    } // end 'bufferLoop === false' if statement.

    // Double bufferLoop prevention
    if (bufferLoop === true) {
      if (this.lastBufferLoopEvent > (Date.now() - this.loopSpeed + 5)) {
        console.log('🔴 DOUBLE BUFFER LOOP DETECTED AND STOPPED.');
        return;
      }
      this.lastBufferLoopEvent = Date.now();
    }

    // Buffer loop.
    if (bufferLoop === true && Date.now() < this.lastKeyEvent.time + this.loopSpeed) {
      console.log('🟣 Buffer Loop Retrigger: ' + this.repeatCount);
      console.log('🟣 IR Repeat Tightness: ' + irRepeatDelay);

      if (this.repeatCount > 10) {
        this.loopSpeed = this.loopSpeed * .7; // Long press? Change volume faster.
        console.log('🏎 fast repeat mode enabled');
      } else if (this.loopSpeed !== this.standardLoopSpeed) {
        this.loopSpeed = this.standardLoopSpeed;
      }

      let repeatDelay = this.loopSpeed;


      let self = this;
      setTimeout(function () {
        self.rawInput(keycode, irRepeatDelay, remoteName, true);
      }, repeatDelay);

      this.repeatCount++;

    } else if (bufferLoop === true) {
      this.repeatCount = 0;
      return;
    } else {
      this.repeatCount = 0;
    }

    // Otherwise, carry on and send the API call.
    this.triggerEvent(keycode, bufferLoop);

    this.lastNewKeypress = Date.now();
  }

  // Actually trigger an event
  triggerEvent(keycode, bufferLoop) {
    console.log('🟢 ' + Date.now() + ': ' + keycode + ': Running with invocation from bufferloop = ' + bufferLoop);
    switch (keycode) {
      case "volumeMute":
        this.mute();
        break;
      case "volumeUp":
        this.eventEmitter.emit('tvCommand', 'volumeup');
        //this.volumeChange("up");
        break;
      case "volumeDown":
        this.eventEmitter.emit('tvCommand', 'volumedown');
        //this.volumeChange("down");
        break;
      case "deviceinput":
        this.eventEmitter.emit('tvCommand', 'deviceinput');
        break;
      case "arrowleft":
        this.eventEmitter.emit('tvCommand', 'arrowleft');
        break;
      case "arrowright":
        this.eventEmitter.emit('tvCommand', 'arrowright');
        break;
      case "ok":
        this.eventEmitter.emit('tvCommand', 'ok');
        break;
      case "back":
        this.eventEmitter.emit('tvCommand', 'returnback');
        break;
      case "lgMute":
        this.eventEmitter.emit('tvCommand', 'volumemute');
        break;
      default:
        console.log("No function bound to input " + keycode);
    }

    return;
  }

  apiRequest(endpoint, keycode, callback) {
    // Make the Axios HTTP Request, now with error handling!
    let request = axios.get(this.apiBase + endpoint).catch(function (error) {
      if (error.response) {
        // console.log(error.response.data);
        // console.log(error.response.status);
        // console.log(error.response.headers);
        console.log('❌ API Request failed! Server responded with status code that falls out of the range of 2xx');
        return false;
      } else if (error.request) {
        //console.log(error.request);
        console.log('❌ API Request failed! Request was made but no response was received.');
        return false;
      } else {
        console.log('❌ API Request failed! Something happened in setting up the request that triggered an Error');
        return false;
      }
    });
    return request;
  }

  mute() {
    const self = this;
    this.apiRequest("Volume").then(function (response) {
      if (response) {
        const isMuted =
          parser.parse(response.data).volume.mute == "1" ? true : false;

        if (isMuted) {
          self.apiRequest("Volume?mute=0");
        } else {
          self.apiRequest("Volume?mute=1");
        }
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

  setupMacInputs(keypress, remote) {
    keypress(process.stdin);
    // listen for the "keypress" event
    process.stdin.on('keypress', function (ch, key) {
      // console.log('got "keypress"', key); // Log ALL keypresses. Helpful for debugging!
      if (key && key.ctrl && key.name == 'c') {
        process.exit()
      }

      Object.keys(remote).forEach(subKey => {
        if (remote[subKey] === key.name && key) {
          irController.rawInput(subKey, remote.systemBuffer, 'Mac Input', false);
        }
      });
    });

    process.stdin.setRawMode(true);
    process.stdin.resume();
  }

  setupLinuxInputs(InputEvent, input, remotes) {
    const keyboard = new InputEvent.Keyboard(input);

    keyboard.on("data", function (buffer) {
      if (argv.i) {
        console.log(buffer); // Log *everything* Useful for discovering IR keycodes
      }

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

  start() {
    const InputEvent = require("input-event");
    console.log("Platform is: " + process.platform);

    if (argv.i) {
      console.log("Log ALL IR events is enabled."); // Log *everything* Useful for discovering IR keycodes
    }
    try {
      console.log('Attempting to use Linux/IR mode.');
      const input = new InputEvent("/dev/input/event0");
      console.log('Using Linux/IR mode.');
      this.setupLinuxInputs(InputEvent, input, this.linuxRemotes);
    } catch (error) {
      // MacOS mode
      console.log('Attempted Linux Mode error: ' + error);
      if (process.platform == 'darwin') {
        console.log('Using MacOS mode.');
        let keypress = require('keypress');
        this.setupMacInputs(keypress, this.macRemote);
      } else {
        console.log('Failed. No suitable setup mode could be used.');
        process.exit;
      }
    }
  }
}

// DISABLED FOR DEBUGGING
let irController = new irControllerSystem();
irController.start();