/** Original uploaded catalog: IDs, roles and loop flags are compatibility constraints. */
export const ORIGINAL = {
  "us-dial": {
    "category": "phone",
    "name": "Dial Tone",
    "hint": "350+440 continuous",
    "loop": true
  },
  "us-ring": {
    "category": "phone",
    "name": "Ringback",
    "hint": "440+480 2s/4s",
    "loop": true
  },
  "us-busy": {
    "category": "phone",
    "name": "Busy",
    "hint": "480+620 0.5s",
    "loop": true
  },
  "us-fast-busy": {
    "category": "phone",
    "name": "Fast Busy",
    "hint": "480+620 0.25s",
    "loop": true
  },
  "uk-ring": {
    "category": "phone",
    "name": "UK Ringback",
    "hint": "400+450 double",
    "loop": true
  },
  "uk-busy": {
    "category": "phone",
    "name": "UK Busy",
    "hint": "400 0.375s",
    "loop": true
  },
  "eu-ring": {
    "category": "phone",
    "name": "EU Ringback",
    "hint": "425 1s/4s",
    "loop": true
  },
  "eu-busy": {
    "category": "phone",
    "name": "EU Busy",
    "hint": "425 0.5s",
    "loop": true
  },
  "jp-ring": {
    "category": "phone",
    "name": "JP Ringback",
    "hint": "400 16Hz AM",
    "loop": true
  },
  "phone-bell": {
    "category": "phone",
    "name": "Mechanical Bell",
    "hint": "20Hz ringer",
    "loop": true
  },
  "off-hook": {
    "category": "phone",
    "name": "Off-Hook",
    "hint": "howler, 4 freq",
    "loop": true
  },
  "sit-tone": {
    "category": "phone",
    "name": "SIT Tone",
    "hint": "intercept x3",
    "loop": false
  },
  "call-waiting": {
    "category": "phone",
    "name": "Call Waiting",
    "hint": "440 beep x2",
    "loop": false
  },
  "rotary": {
    "category": "phone",
    "name": "Rotary Dial",
    "hint": "pulse clicks",
    "loop": false
  },
  "fax": {
    "category": "phone",
    "name": "Fax",
    "hint": "CNG + carrier",
    "loop": false
  },
  "payphone": {
    "category": "phone",
    "name": "Coin Deposit",
    "hint": "payphone dings",
    "loop": false
  },
  "dtmf-1": {
    "category": "dtmf",
    "name": "1",
    "hint": "697+1209",
    "loop": false
  },
  "dtmf-2": {
    "category": "dtmf",
    "name": "2",
    "hint": "697+1336",
    "loop": false
  },
  "dtmf-3": {
    "category": "dtmf",
    "name": "3",
    "hint": "697+1477",
    "loop": false
  },
  "dtmf-A": {
    "category": "dtmf",
    "name": "A",
    "hint": "697+1633",
    "loop": false
  },
  "dtmf-4": {
    "category": "dtmf",
    "name": "4",
    "hint": "770+1209",
    "loop": false
  },
  "dtmf-5": {
    "category": "dtmf",
    "name": "5",
    "hint": "770+1336",
    "loop": false
  },
  "dtmf-6": {
    "category": "dtmf",
    "name": "6",
    "hint": "770+1477",
    "loop": false
  },
  "dtmf-B": {
    "category": "dtmf",
    "name": "B",
    "hint": "770+1633",
    "loop": false
  },
  "dtmf-7": {
    "category": "dtmf",
    "name": "7",
    "hint": "852+1209",
    "loop": false
  },
  "dtmf-8": {
    "category": "dtmf",
    "name": "8",
    "hint": "852+1336",
    "loop": false
  },
  "dtmf-9": {
    "category": "dtmf",
    "name": "9",
    "hint": "852+1477",
    "loop": false
  },
  "dtmf-C": {
    "category": "dtmf",
    "name": "C",
    "hint": "852+1633",
    "loop": false
  },
  "dtmf-*": {
    "category": "dtmf",
    "name": "*",
    "hint": "941+1209",
    "loop": false
  },
  "dtmf-0": {
    "category": "dtmf",
    "name": "0",
    "hint": "941+1336",
    "loop": false
  },
  "dtmf-#": {
    "category": "dtmf",
    "name": "#",
    "hint": "941+1477",
    "loop": false
  },
  "dtmf-D": {
    "category": "dtmf",
    "name": "D",
    "hint": "941+1633",
    "loop": false
  },
  "tap": {
    "category": "ui",
    "name": "Tap",
    "hint": "1kHz click",
    "loop": false
  },
  "pop": {
    "category": "ui",
    "name": "Pop",
    "hint": "rising sine",
    "loop": false
  },
  "ping": {
    "category": "ui",
    "name": "Ping",
    "hint": "two-note bell",
    "loop": false
  },
  "message": {
    "category": "ui",
    "name": "Message",
    "hint": "marimba blip",
    "loop": false
  },
  "success": {
    "category": "ui",
    "name": "Success",
    "hint": "major arpeggio",
    "loop": false
  },
  "error": {
    "category": "ui",
    "name": "Error",
    "hint": "low buzz x2",
    "loop": false
  },
  "warning": {
    "category": "ui",
    "name": "Warning",
    "hint": "3 bleeps",
    "loop": false
  },
  "toggle-on": {
    "category": "ui",
    "name": "Toggle On",
    "hint": "up blip",
    "loop": false
  },
  "toggle-off": {
    "category": "ui",
    "name": "Toggle Off",
    "hint": "down blip",
    "loop": false
  },
  "tick": {
    "category": "ui",
    "name": "Tick",
    "hint": "tiny click",
    "loop": false
  },
  "unlock": {
    "category": "ui",
    "name": "Unlock",
    "hint": "up two-note",
    "loop": false
  },
  "lock": {
    "category": "ui",
    "name": "Lock",
    "hint": "down two-note",
    "loop": false
  },
  "shutter": {
    "category": "ui",
    "name": "Shutter",
    "hint": "camera click",
    "loop": false
  },
  "send": {
    "category": "ui",
    "name": "Send",
    "hint": "noise sweep up",
    "loop": false
  },
  "receive": {
    "category": "ui",
    "name": "Receive",
    "hint": "noise sweep down",
    "loop": false
  },
  "delete": {
    "category": "ui",
    "name": "Delete",
    "hint": "crunch down",
    "loop": false
  },
  "bubble": {
    "category": "ui",
    "name": "Bubble",
    "hint": "wobbly rise",
    "loop": false
  },
  "charge": {
    "category": "ui",
    "name": "Charging",
    "hint": "glide + ping",
    "loop": false
  },
  "low-battery": {
    "category": "ui",
    "name": "Low Battery",
    "hint": "sad x2",
    "loop": false
  },
  "key-press": {
    "category": "ui",
    "name": "Keyboard",
    "hint": "soft thock",
    "loop": false
  },
  "countdown": {
    "category": "ui",
    "name": "Countdown",
    "hint": "3-2-1-go",
    "loop": false
  },
  "cha-ching": {
    "category": "ui",
    "name": "Cha-Ching",
    "hint": "cash register",
    "loop": false
  },
  "typewriter": {
    "category": "ui",
    "name": "Typewriter",
    "hint": "clack + ding",
    "loop": false
  },
  "page-flip": {
    "category": "ui",
    "name": "Page Flip",
    "hint": "paper flutter",
    "loop": false
  },
  "coin": {
    "category": "arcade",
    "name": "Coin",
    "hint": "B5 to E6",
    "loop": false
  },
  "jump": {
    "category": "arcade",
    "name": "Jump",
    "hint": "square up",
    "loop": false
  },
  "laser": {
    "category": "arcade",
    "name": "Laser",
    "hint": "down sweep",
    "loop": false
  },
  "power-up": {
    "category": "arcade",
    "name": "Power Up",
    "hint": "ascending run",
    "loop": false
  },
  "power-down": {
    "category": "arcade",
    "name": "Power Down",
    "hint": "descending run",
    "loop": false
  },
  "one-up": {
    "category": "arcade",
    "name": "1-UP",
    "hint": "jingle",
    "loop": false
  },
  "blip": {
    "category": "arcade",
    "name": "Blip",
    "hint": "single note",
    "loop": false
  },
  "explode": {
    "category": "arcade",
    "name": "Explosion",
    "hint": "noise + thump",
    "loop": false
  },
  "hurt": {
    "category": "arcade",
    "name": "Hurt",
    "hint": "noise + drop",
    "loop": false
  },
  "select": {
    "category": "arcade",
    "name": "Select",
    "hint": "two blips",
    "loop": false
  },
  "game-over": {
    "category": "arcade",
    "name": "Game Over",
    "hint": "sad descent",
    "loop": false
  },
  "victory": {
    "category": "arcade",
    "name": "Victory",
    "hint": "fanfare",
    "loop": false
  },
  "bounce": {
    "category": "arcade",
    "name": "Bounce",
    "hint": "boing",
    "loop": false
  },
  "pause": {
    "category": "arcade",
    "name": "Pause",
    "hint": "hi-lo blip",
    "loop": false
  },
  "checkpoint": {
    "category": "arcade",
    "name": "Checkpoint",
    "hint": "twinkle",
    "loop": false
  },
  "bomb": {
    "category": "arcade",
    "name": "Bomb Drop",
    "hint": "whistle + boom",
    "loop": false
  },
  "invader": {
    "category": "arcade",
    "name": "Invader March",
    "hint": "bass steps",
    "loop": false
  },
  "score": {
    "category": "arcade",
    "name": "Score Count",
    "hint": "rapid tally",
    "loop": false
  },
  "pinball": {
    "category": "arcade",
    "name": "Pinball",
    "hint": "bumper pop",
    "loop": false
  },
  "pew": {
    "category": "arcade",
    "name": "Pew",
    "hint": "short zap",
    "loop": false
  },
  "combo": {
    "category": "arcade",
    "name": "Combo Hit",
    "hint": "3 rising stabs",
    "loop": false
  },
  "line-clear": {
    "category": "arcade",
    "name": "Line Clear",
    "hint": "gliss + shine",
    "loop": false
  },
  "waka": {
    "category": "arcade",
    "name": "Waka Waka",
    "hint": "chomp loop",
    "loop": true
  },
  "honk": {
    "category": "cartoon",
    "name": "Clown Horn",
    "hint": "honka honka",
    "loop": false
  },
  "sproing": {
    "category": "cartoon",
    "name": "Sproing",
    "hint": "spring wobble",
    "loop": false
  },
  "cuckoo": {
    "category": "cartoon",
    "name": "Cuckoo",
    "hint": "cu-koo x2",
    "loop": false
  },
  "anvil": {
    "category": "cartoon",
    "name": "Anvil",
    "hint": "CLANG",
    "loop": false
  },
  "punch": {
    "category": "cartoon",
    "name": "Punch",
    "hint": "whoosh + thud",
    "loop": false
  },
  "record-scratch": {
    "category": "cartoon",
    "name": "Record Scratch",
    "hint": "wicki wicki",
    "loop": false
  },
  "tiptoe": {
    "category": "cartoon",
    "name": "Tip-Toe",
    "hint": "sneaky plucks",
    "loop": false
  },
  "falling": {
    "category": "cartoon",
    "name": "Falling",
    "hint": "whistle + splat",
    "loop": false
  },
  "siren": {
    "category": "alarm",
    "name": "Siren",
    "hint": "rise/fall",
    "loop": true
  },
  "wail": {
    "category": "alarm",
    "name": "Wail",
    "hint": "slow sweep",
    "loop": true
  },
  "two-tone": {
    "category": "alarm",
    "name": "Two-Tone",
    "hint": "hi-lo",
    "loop": true
  },
  "red-alert": {
    "category": "alarm",
    "name": "Red Alert",
    "hint": "rising loop",
    "loop": true
  },
  "alarm-clock": {
    "category": "alarm",
    "name": "Alarm Clock",
    "hint": "beep-beep",
    "loop": true
  },
  "smoke-detector": {
    "category": "alarm",
    "name": "Smoke Detector",
    "hint": "3 chirps",
    "loop": true
  },
  "buzzer": {
    "category": "alarm",
    "name": "Buzzer",
    "hint": "harsh hold",
    "loop": true
  },
  "reverse-beep": {
    "category": "alarm",
    "name": "Reverse Beep",
    "hint": "truck backup",
    "loop": true
  },
  "vibrate": {
    "category": "alarm",
    "name": "Vibrate",
    "hint": "bzzt bzzt",
    "loop": true
  },
  "crossing-bell": {
    "category": "alarm",
    "name": "Crossing Bell",
    "hint": "fast clang",
    "loop": true
  },
  "car-alarm": {
    "category": "alarm",
    "name": "Car Alarm",
    "hint": "cycling modes",
    "loop": true
  },
  "microwave": {
    "category": "alarm",
    "name": "Microwave Done",
    "hint": "3 beeps",
    "loop": false
  },
  "klaxon": {
    "category": "alarm",
    "name": "Klaxon",
    "hint": "a-oo-ga",
    "loop": false
  },
  "doorbell": {
    "category": "alarm",
    "name": "Doorbell",
    "hint": "ding-dong",
    "loop": false
  },
  "foghorn": {
    "category": "alarm",
    "name": "Foghorn",
    "hint": "low blast",
    "loop": false
  },
  "bike-bell": {
    "category": "alarm",
    "name": "Bike Bell",
    "hint": "brrring",
    "loop": false
  },
  "air-horn": {
    "category": "alarm",
    "name": "Air Horn",
    "hint": "stadium blast",
    "loop": false
  },
  "alert-tone": {
    "category": "alarm",
    "name": "Alert Tone",
    "hint": "853+960 harsh",
    "loop": false
  },
  "boxing-bell": {
    "category": "alarm",
    "name": "Boxing Bell",
    "hint": "ding ding ding",
    "loop": false
  },
  "kick": {
    "category": "perc",
    "name": "Kick",
    "hint": "140 to 45 drop",
    "loop": false
  },
  "snare": {
    "category": "perc",
    "name": "Snare",
    "hint": "tone + noise",
    "loop": false
  },
  "hat": {
    "category": "perc",
    "name": "Hi-Hat",
    "hint": "7kHz tick",
    "loop": false
  },
  "open-hat": {
    "category": "perc",
    "name": "Open Hat",
    "hint": "long sizzle",
    "loop": false
  },
  "tom": {
    "category": "perc",
    "name": "Tom",
    "hint": "200 to 90 drop",
    "loop": false
  },
  "clap": {
    "category": "perc",
    "name": "Clap",
    "hint": "burst stack",
    "loop": false
  },
  "cowbell": {
    "category": "perc",
    "name": "Cowbell",
    "hint": "540+800",
    "loop": false
  },
  "woodblock": {
    "category": "perc",
    "name": "Woodblock",
    "hint": "1.2kHz",
    "loop": false
  },
  "rimshot": {
    "category": "perc",
    "name": "Rimshot",
    "hint": "click + tone",
    "loop": false
  },
  "crash": {
    "category": "perc",
    "name": "Crash",
    "hint": "long wash",
    "loop": false
  },
  "ride": {
    "category": "perc",
    "name": "Ride",
    "hint": "ping + wash",
    "loop": false
  },
  "shaker": {
    "category": "perc",
    "name": "Shaker",
    "hint": "5.5kHz chk",
    "loop": false
  },
  "bongo": {
    "category": "perc",
    "name": "Bongo",
    "hint": "330 to 200",
    "loop": false
  },
  "808": {
    "category": "perc",
    "name": "808 Bass",
    "hint": "50Hz sub",
    "loop": false
  },
  "triangle": {
    "category": "perc",
    "name": "Triangle",
    "hint": "metal ring",
    "loop": false
  },
  "tambourine": {
    "category": "perc",
    "name": "Tambourine",
    "hint": "jingles",
    "loop": false
  },
  "timpani": {
    "category": "perc",
    "name": "Timpani",
    "hint": "95 to 70 boom",
    "loop": false
  },
  "snap": {
    "category": "perc",
    "name": "Snap",
    "hint": "finger snap",
    "loop": false
  },
  "guiro": {
    "category": "perc",
    "name": "Guiro",
    "hint": "ratchet scrape",
    "loop": false
  },
  "drum-roll": {
    "category": "perc",
    "name": "Drum Roll",
    "hint": "snare roll",
    "loop": true
  },
  "sonar": {
    "category": "scifi",
    "name": "Sonar Ping",
    "hint": "long decay",
    "loop": false
  },
  "sweep-up": {
    "category": "scifi",
    "name": "Sweep Up",
    "hint": "200 to 2k saw",
    "loop": false
  },
  "sweep-down": {
    "category": "scifi",
    "name": "Sweep Down",
    "hint": "2k to 200 saw",
    "loop": false
  },
  "zap": {
    "category": "scifi",
    "name": "Zap",
    "hint": "wobble drop",
    "loop": false
  },
  "teleport": {
    "category": "scifi",
    "name": "Teleport",
    "hint": "arp + noise",
    "loop": false
  },
  "boot": {
    "category": "scifi",
    "name": "Boot Up",
    "hint": "ascending chime",
    "loop": false
  },
  "glitch": {
    "category": "scifi",
    "name": "Glitch",
    "hint": "random bursts",
    "loop": false
  },
  "modem": {
    "category": "scifi",
    "name": "Modem",
    "hint": "dial-up vibe",
    "loop": false
  },
  "shield": {
    "category": "scifi",
    "name": "Shield Hit",
    "hint": "metal ping",
    "loop": false
  },
  "disintegrate": {
    "category": "scifi",
    "name": "Disintegrate",
    "hint": "crumble down",
    "loop": false
  },
  "alien-signal": {
    "category": "scifi",
    "name": "Alien Signal",
    "hint": "eerie tones",
    "loop": false
  },
  "hyperdrive": {
    "category": "scifi",
    "name": "Hyperdrive",
    "hint": "big spool-up",
    "loop": false
  },
  "droid": {
    "category": "scifi",
    "name": "Droid Chatter",
    "hint": "random chirps",
    "loop": false
  },
  "morse-sos": {
    "category": "scifi",
    "name": "Morse SOS",
    "hint": "dot dot dot dash",
    "loop": false
  },
  "charge-up": {
    "category": "scifi",
    "name": "Charge Up",
    "hint": "whine + release",
    "loop": false
  },
  "portal": {
    "category": "scifi",
    "name": "Portal",
    "hint": "shimmer swell",
    "loop": false
  },
  "robot-talk": {
    "category": "scifi",
    "name": "Robot Talk",
    "hint": "formant gibberish",
    "loop": false
  },
  "floppy": {
    "category": "scifi",
    "name": "Floppy Seek",
    "hint": "grunk grunk",
    "loop": false
  },
  "tape-rewind": {
    "category": "scifi",
    "name": "Tape Rewind",
    "hint": "squeal up",
    "loop": false
  },
  "crt-on": {
    "category": "scifi",
    "name": "CRT On",
    "hint": "degauss + whine",
    "loop": false
  },
  "crt-off": {
    "category": "scifi",
    "name": "CRT Off",
    "hint": "collapse blip",
    "loop": false
  },
  "ufo": {
    "category": "scifi",
    "name": "UFO Hover",
    "hint": "warble",
    "loop": true
  },
  "forcefield": {
    "category": "scifi",
    "name": "Forcefield",
    "hint": "low hum",
    "loop": true
  },
  "scanner": {
    "category": "scifi",
    "name": "Scanner",
    "hint": "sweep ticks",
    "loop": true
  },
  "computer": {
    "category": "scifi",
    "name": "Computer",
    "hint": "random blips",
    "loop": true
  },
  "geiger": {
    "category": "scifi",
    "name": "Geiger",
    "hint": "random clicks",
    "loop": true
  },
  "static": {
    "category": "scifi",
    "name": "Radio Static",
    "hint": "white hiss",
    "loop": true
  },
  "dot-matrix": {
    "category": "scifi",
    "name": "Dot Matrix",
    "hint": "printer head",
    "loop": true
  },
  "creaky-door": {
    "category": "spooky",
    "name": "Creaky Door",
    "hint": "slow hinge",
    "loop": false
  },
  "ghost": {
    "category": "spooky",
    "name": "Ghost Wail",
    "hint": "oooooh",
    "loop": false
  },
  "jump-scare": {
    "category": "spooky",
    "name": "Jump Scare",
    "hint": "dissonant hit",
    "loop": false
  },
  "haunted-box": {
    "category": "spooky",
    "name": "Haunted Box",
    "hint": "detuned lullaby",
    "loop": false
  },
  "raven": {
    "category": "spooky",
    "name": "Raven",
    "hint": "harsh caw",
    "loop": false
  },
  "dread": {
    "category": "spooky",
    "name": "Dread Drone",
    "hint": "breathing cluster",
    "loop": true
  },
  "theremin": {
    "category": "spooky",
    "name": "Theremin",
    "hint": "spooky wander",
    "loop": true
  },
  "bird": {
    "category": "nature",
    "name": "Songbird",
    "hint": "warble + trill",
    "loop": false
  },
  "owl": {
    "category": "nature",
    "name": "Owl",
    "hint": "hoo-hoo",
    "loop": false
  },
  "frog": {
    "category": "nature",
    "name": "Frog",
    "hint": "rib-bit",
    "loop": false
  },
  "dog": {
    "category": "nature",
    "name": "Dog",
    "hint": "woof woof",
    "loop": false
  },
  "cat": {
    "category": "nature",
    "name": "Cat",
    "hint": "meow",
    "loop": false
  },
  "rooster": {
    "category": "nature",
    "name": "Rooster",
    "hint": "4-note crow",
    "loop": false
  },
  "cow": {
    "category": "nature",
    "name": "Cow",
    "hint": "moo",
    "loop": false
  },
  "duck": {
    "category": "nature",
    "name": "Duck",
    "hint": "quack x3",
    "loop": false
  },
  "wolf": {
    "category": "nature",
    "name": "Wolf",
    "hint": "long howl",
    "loop": false
  },
  "seagull": {
    "category": "nature",
    "name": "Seagull",
    "hint": "cries",
    "loop": false
  },
  "woodpecker": {
    "category": "nature",
    "name": "Woodpecker",
    "hint": "rapid drum",
    "loop": false
  },
  "dove": {
    "category": "nature",
    "name": "Dove",
    "hint": "soft coo",
    "loop": false
  },
  "whale": {
    "category": "nature",
    "name": "Whale",
    "hint": "deep song",
    "loop": false
  },
  "thunder": {
    "category": "nature",
    "name": "Thunder",
    "hint": "long rumble",
    "loop": false
  },
  "crickets": {
    "category": "nature",
    "name": "Crickets",
    "hint": "night pulses",
    "loop": true
  },
  "bee": {
    "category": "nature",
    "name": "Bee",
    "hint": "buzz hover",
    "loop": true
  },
  "heartbeat": {
    "category": "nature",
    "name": "Heartbeat",
    "hint": "lub-dub",
    "loop": true
  },
  "rain": {
    "category": "nature",
    "name": "Rain",
    "hint": "steady patter",
    "loop": true
  },
  "wind": {
    "category": "nature",
    "name": "Wind",
    "hint": "gusting",
    "loop": true
  },
  "ocean": {
    "category": "nature",
    "name": "Ocean Waves",
    "hint": "slow surf",
    "loop": true
  },
  "campfire": {
    "category": "nature",
    "name": "Campfire",
    "hint": "crackle",
    "loop": true
  },
  "mosquito": {
    "category": "nature",
    "name": "Mosquito",
    "hint": "wandering whine",
    "loop": true
  },
  "gallop": {
    "category": "nature",
    "name": "Gallop",
    "hint": "hoof beats",
    "loop": true
  },
  "wolf-whistle": {
    "category": "human",
    "name": "Wolf Whistle",
    "hint": "whit-whew",
    "loop": false
  },
  "knock": {
    "category": "human",
    "name": "Door Knock",
    "hint": "knock x3",
    "loop": false
  },
  "kiss": {
    "category": "human",
    "name": "Kiss",
    "hint": "mwah",
    "loop": false
  },
  "ref-whistle": {
    "category": "human",
    "name": "Ref Whistle",
    "hint": "pea trill",
    "loop": false
  },
  "snore": {
    "category": "human",
    "name": "Snore",
    "hint": "in... out",
    "loop": true
  },
  "footsteps": {
    "category": "human",
    "name": "Footsteps",
    "hint": "walk loop",
    "loop": true
  },
  "applause": {
    "category": "human",
    "name": "Applause",
    "hint": "crowd clap",
    "loop": true
  },
  "helicopter": {
    "category": "machine",
    "name": "Helicopter",
    "hint": "rotor chop",
    "loop": true
  },
  "train-horn": {
    "category": "machine",
    "name": "Train Horn",
    "hint": "big chord",
    "loop": false
  },
  "steam-train": {
    "category": "machine",
    "name": "Steam Train",
    "hint": "chug loop",
    "loop": true
  },
  "jet-flyby": {
    "category": "machine",
    "name": "Jet Flyby",
    "hint": "doppler pass",
    "loop": false
  },
  "chainsaw": {
    "category": "machine",
    "name": "Chainsaw",
    "hint": "rip loop",
    "loop": true
  },
  "drill": {
    "category": "machine",
    "name": "Power Drill",
    "hint": "high whine",
    "loop": true
  },
  "engine-rev": {
    "category": "machine",
    "name": "Engine Rev",
    "hint": "vroom",
    "loop": false
  },
  "tick-tock": {
    "category": "machine",
    "name": "Tick-Tock",
    "hint": "clock loop",
    "loop": true
  },
  "car-horn": {
    "category": "machine",
    "name": "Car Horn",
    "hint": "honk honk",
    "loop": false
  },
  "drip": {
    "category": "household",
    "name": "Water Drip",
    "hint": "plink loop",
    "loop": true
  },
  "pour": {
    "category": "household",
    "name": "Pouring",
    "hint": "glug + fizz",
    "loop": false
  },
  "sizzle": {
    "category": "household",
    "name": "Sizzle",
    "hint": "frying pan",
    "loop": true
  },
  "boiling": {
    "category": "household",
    "name": "Boiling",
    "hint": "bubble pot",
    "loop": true
  },
  "kettle": {
    "category": "household",
    "name": "Kettle",
    "hint": "whistle swell",
    "loop": false
  },
  "vacuum": {
    "category": "household",
    "name": "Vacuum",
    "hint": "motor + air",
    "loop": true
  },
  "blender": {
    "category": "household",
    "name": "Blender",
    "hint": "spin-up whine",
    "loop": true
  },
  "flush": {
    "category": "household",
    "name": "Toilet Flush",
    "hint": "whoosh + gurgle",
    "loop": false
  },
  "squeaky-toy": {
    "category": "household",
    "name": "Squeaky Toy",
    "hint": "squeak-squeak",
    "loop": false
  },
  "balloon-pop": {
    "category": "household",
    "name": "Balloon Pop",
    "hint": "sharp crack",
    "loop": false
  },
  "zipper": {
    "category": "household",
    "name": "Zipper",
    "hint": "zzzzip",
    "loop": false
  },
  "spray": {
    "category": "household",
    "name": "Spray Can",
    "hint": "psssht",
    "loop": false
  },
  "glass-clink": {
    "category": "household",
    "name": "Glass Clink",
    "hint": "cheers",
    "loop": false
  },
  "glass-break": {
    "category": "household",
    "name": "Glass Break",
    "hint": "crash + shards",
    "loop": false
  },
  "organ": {
    "category": "music",
    "name": "Organ Chord",
    "hint": "C maj drone",
    "loop": true
  },
  "major-chord": {
    "category": "music",
    "name": "Major Chord",
    "hint": "C-E-G sine",
    "loop": false
  },
  "minor-chord": {
    "category": "music",
    "name": "Minor Chord",
    "hint": "A-C-E saw",
    "loop": false
  },
  "gong": {
    "category": "music",
    "name": "Gong",
    "hint": "deep shimmer",
    "loop": false
  },
  "slide-up": {
    "category": "music",
    "name": "Slide Whistle Up",
    "hint": "350 to 1.4k",
    "loop": false
  },
  "slide-down": {
    "category": "music",
    "name": "Slide Whistle Down",
    "hint": "1.4k to 350",
    "loop": false
  },
  "tuning-fork": {
    "category": "music",
    "name": "Tuning Fork",
    "hint": "A440 pure",
    "loop": false
  },
  "music-box": {
    "category": "music",
    "name": "Music Box",
    "hint": "tiny melody",
    "loop": false
  },
  "church-bell": {
    "category": "music",
    "name": "Church Bell",
    "hint": "bronze toll",
    "loop": false
  },
  "harp": {
    "category": "music",
    "name": "Harp Gliss",
    "hint": "sweep up",
    "loop": false
  },
  "sad-trombone": {
    "category": "music",
    "name": "Sad Trombone",
    "hint": "wah x4",
    "loop": false
  },
  "metronome": {
    "category": "music",
    "name": "Metronome",
    "hint": "120 BPM",
    "loop": true
  },
  "scale": {
    "category": "music",
    "name": "Scale Run",
    "hint": "do-re-mi",
    "loop": false
  },
  "vinyl": {
    "category": "music",
    "name": "Vinyl",
    "hint": "crackle bed",
    "loop": true
  },
  "bass-pluck": {
    "category": "music",
    "name": "Bass Pluck",
    "hint": "funky thump",
    "loop": false
  },
  "choir": {
    "category": "music",
    "name": "Choir",
    "hint": "formant ahh",
    "loop": false
  },
  "orchestra-hit": {
    "category": "music",
    "name": "Orchestra Hit",
    "hint": "big stab",
    "loop": false
  },
  "pizzicato": {
    "category": "music",
    "name": "Pizzicato",
    "hint": "string pluck",
    "loop": false
  },
  "wobble-bass": {
    "category": "music",
    "name": "Wobble Bass",
    "hint": "filter LFO",
    "loop": true
  }
} as const;
export type OriginalId = keyof typeof ORIGINAL;
