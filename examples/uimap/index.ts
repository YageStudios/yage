import { InputEventType, InputManager } from "yage/inputs/InputManager";
import { KeyboardListener } from "yage/inputs/KeyboardListener";
import { UIService } from "yage/ui/UIService";
import { CustomUIParser } from "yage/ui/UiMapNext";

document.body.style.backgroundColor = "#333";
const uiService = UIService.getInstance();

uiService.playerInputs = [[InputEventType.MOUSE, 0]];
const inputManager = new InputManager();
const keyboardListener = new KeyboardListener(inputManager);
keyboardListener.init(["w", "a", "s", "d", "i", "j", "k", "l", "space", "escape"]);
uiService.enableKeyCapture(inputManager);

const parser = new CustomUIParser(`
<Box width="1350" x="left" height="300" y="top">
  <Text y="100" x="right">
  Welcome, {{user.name}}!
  </Text>
  <Button onclick="clickuser" width="100%" x="left" height="100%" y="top">
    Click me, {{user.name}}!
  </Button>
</Box> 
  `);

const element = parser.build(
  {
    user: {
      name: "John Doe",
    },
  },
  (...eventParams) => {
    console.log(eventParams);
  }
);

uiService.addToUI(element);
