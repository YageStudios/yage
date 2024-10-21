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

// const parser = new CustomUIParser(
//   `
//   <Box width="1920" x="left" height="1080" y="top">
//   <Grid items="{{children}}" width="full" x="left" height="full" y="top">
//   <Box width="100" height="100">
//     test? {{this.user.name}}
//   </Box>
// </Grid>
// <Box x="left" y="bottom" width="{{test}}%" style="backgroundColor: red;" height="100">
//     {{test}}
//   </Box>
// </Box>
// <Text x="left" y="top" yOffset="200">
//       test? {{name}}
// </Text>

// <Text x="left" y="bottom" yOffset="200">
// {{#with user}}
//       test? {{name}}
// {{/with}}
//       </Text>

//   `,
//   partials
// );

const partials = {
  header: `
  <Box width="1920" x="left" height="100" y="top">
    test {{this}} {{test}}
    </Box>`,
  test: `
    <Text x="center" y="center" yOffset="{{test}}" >
      test? {{name}}!
      </Text>`,

  box: `<Box width="100" height="100">
    {{this.test}} / {{test / 2}}
  </Box>`,
};

const parser = new CustomUIParser(
  `
<Box width="1920" x="left" height="1080" y="top">
  <Grid items="{{ children }}" width="full" x="left" height="full" y="top">
    <Box width="100" height="100"> test? {{ this.user.name }} </Box>
  </Grid>
  <Box x="left" y="bottom" width="{{ test }}%" style="background-color: red" height="100">
    {{ test }}
  </Box>

  {{#if test > 50}}
  <Box x="right" y="top" yOffset="200" xOffset="-200">
    {{#with children.1.user}}
    test? {{ name }}?????????
    {{/with}}
  </Box>
  {{/if}}

  <Box x="right" y="top" yOffset="200" xOffset="-300" width="300">
    {{> test user}}
    {{> test }}
  </Box>
</Box>
  `,
  partials
);

// const parser = new CustomUIParser(`
//   <Box width="1920" x="left" height="1080" y="top">

// <Box x="left" y="bottom" width="{{test}}%" style="backgroundColor: red;" height="100">
//     Hello?
//   </Box>
// </Box>
//   `);
const element = parser.build(
  {
    name: "John Doe",
    user: {
      name: "Bob Doelen",
    },
    test: 100,
    children: [
      {
        test: "blah",
        user: {
          name: "John Doe",
        },
      },
      {
        test: 99,
        user: {
          name: "Jill Doe",
        },
      },
      {
        test: 100,
        user: {
          name: "Jane Doe",
        },
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
}, 10);
uiService.addToUI(element);

document.addEventListener("mousemove", updateTest);
