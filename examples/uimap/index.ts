import { debounce } from "lodash";
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

// const parser = new CustomUIParser(`
// <Box width="1350" x="left" height="300" y="top">
//   <Text y="100" x="right" x="{{test}}" >
//   Welcome, {{user.name}}!
//   </Text>
//   <Button onclick="clickuser" width="100%" x="left" height="100%" y="top">
//     Click me, {{user.name}}!
//   </Button>
// </Box>
// <Grid items={{children}}>
//   <Box width="100" x="left" height="100" y="bottom">
//     {{this.test}}
//   </Box>
// </Grid>
//   `);

const parser = new CustomUIParser(`
  <Box width="1920" x="left" height="1080" y="top">
<Grid items="{{children}}" width="full" x="left" height="full" y="top">
  <Box width="{{test}}" height="100">
    {{this.test}}
  </Box>
</Grid>
</Box>
  `);
const element = parser.build(
  {
    user: {
      name: "John Doe",
    },
    test: 100,
    children: [
      {
        test: 98,
      },
      {
        test: 99,
      },
      {
        test: 100,
      },
    ],
  },
  (...eventParams) => {
    console.log(eventParams);
  }
);

const updateTest = debounce((e) => {
  const y = e.clientY / window.innerHeight;
  parser.update({ test: y * 100 });
}, 100);
uiService.addToUI(element);

document.addEventListener("mousemove", updateTest);
