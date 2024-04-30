export type TiledProperty = {
  name: string;
  type: string;
  value: any;
};

export type TiledObject = {
  visible: boolean;
  height: number;
  width: number;
  properties?: TiledProperty[];
  rotation: number;
  type: string;
  gid?: number;
  name: string;
  x: number;
  y: number;
  ellipse?: boolean;
  radius?: number;
  polyline?: { x: number; y: number }[];
  polygon?: { x: number; y: number }[];
};

export type TiledTileLayer = TiledLayerBase & {
  type: "tilelayer";
  width: number;
  height: number;
  data: number[];
  visible: boolean;
};

export type TiledObjectLayer = TiledLayerBase & {
  type: "objectgroup";
  objects: TiledObject[];
};

export type TiledLayerBase = {
  name: string;
  x: number;
  y: number;
  properties?: TiledProperty[];
  type: "objectgroup" | "tilelayer";
};

export type TiledTileset = {
  columns: number;
  source?: string;
  firstgid: number;
  imageheight: number;
  imagewidth: number;
  margin: number;
  name: string;
  spacing: number;
  tilecount: number;
  tileheight: number;
  tilewidth: number;
};

export type TiledMap = {
  layers: TiledLayerBase[];
  tilesets: TiledTileset[];
  tilewidth: number;
  tileheight: number;
  width: number;
  height: number;
  orientation: "orthogonal" | "isometric" | "staggered" | "hexagonal";
};

export type PreloadImageConfig = {
  width: number;
  height: number;
  animationSpeed: number;
  initialRotation: number;
  xoffset: number;
  yoffset: number;
};
