import { UIService } from "yage/ui/UIService";
import { CustomUIParser } from "yage/ui/UiMapNext";

const uiService = UIService.getInstance();
const parser = new CustomUIParser(`
<Box>
  <Text label="Welcome, {{user.name}}!" />
  <Button onclick="clickuser">
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
