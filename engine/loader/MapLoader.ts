import type { TiledMap, TiledObject, TiledObjectLayer, TiledTileLayer, TiledTileset } from "yage/types/Tiled";
import { hexToRgb } from "yage/utils/colors";
import sharedFetch from "yage/utils/sharedFetch";
import type { ImageObj } from "./ImageLoader";
import ImageLoader from "./ImageLoader";
// @ts-ignore
import noise from "yage/vendor/noise";
import type { ComponentData } from "yage/systems/types";
import * as url from "url";
import { assignGlobalSingleton } from "yage/global";

export type MapDefinition = {
  mapType: string;
  key: string;
  url: string;
};
export type CustomTile = { name: string; width: number; height: number };

export type IsometricFloor = {
  imageData: HTMLImageElement | null;
  center: { x: number; y: number };
};

export type GameTrigger = {
  name: string;
  type: string;
  condition: any;
  components: ComponentData[];
  x: number;
  y: number;
  width: number;
  height: number;
  properties: { [key: string]: string | boolean | string | any };
};

type MapData = {
  data: number[];
  height: number;
  width: number;
  customTiles: any;
};

export type GameMap = {
  source: TiledMap;
  map: MapData;
  triggers: GameTrigger[];
};

export type ZindexCollider = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TileImage = {
  name: string;
  image: ImageObj;
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  zIndexes: ZindexCollider[];
};

type MapSkinJson = {
  name: string;
  walls: string[];
  floor: {
    stamp: string;
    density: number;
    baseColor: string;
    stampColor: string;
  };
};

export type Tileset = {
  firstgid: number;
  type: "tileset" | "imagegroup";
  images: { [key: number]: TileImage };
};

export type GameTile = {
  sprites: any[];
  tilesets: Tileset[];
  layers: (TiledTileLayer | TiledObjectLayer)[];
  imageData: HTMLImageElement | null;
  center: { x: number; y: number };
  padding: { x: number; y: number };
};

const rotationMasks = {
  diagonal: 0x20000000,
  vertical: 0x40000000,
  horizontal: 0x80000000,
};

export default class MapLoader {
  private static _instance: MapLoader;
  private maps: { [key: string]: GameMap } = {};
  private tilesetPromises: { [key: string]: Promise<Tileset> } = {};
  private tilesets: { [key: string]: Tileset } = {};
  mapTiles: { [key: string]: GameTile } = {};
  private canvas = document.createElement("canvas");
  private mapFloors: { [key: string]: IsometricFloor[] } = {};
  skins: { [key: string]: MapSkinJson } = {};

  static getInstance(): MapLoader {
    return assignGlobalSingleton("MapLoader", () => new MapLoader());
  }

  public get(name: string): GameMap {
    return this.maps[name];
  }

  public getSkin(name: string): {
    floor: {
      stamp: string;
      density: number;
      baseColor: string;
      stampColor: string;
    };
    tiles: { [key: string]: GameTile };
  } {
    return {
      floor: this.skins[name].floor,
      tiles: Object.entries(this.mapTiles).reduce((acc, [key, value]) => {
        if (key.startsWith(name)) {
          acc[key] = value;
        }
        return acc;
      }, {} as { [key: string]: GameTile }),
    };
  }

  public getFloor(name: string) {
    return {
      floors: this.mapFloors[name],
      ...this.skins[name].floor,
    };
  }

  public async loadMap(name: string, url: string): Promise<GameMap> {
    if (this.maps[name]) {
      return this.maps[name];
    }
    const mapData = await this.loadMapData(url, name);
    this.maps[name] = mapData;
    return mapData;
  }

  private async loadMapData(
    url: string,
    name: string
  ): Promise<{ source: TiledMap; map: any; triggers: GameTrigger[] }> {
    const response = await sharedFetch(url);
    const rootPath = url.split("/").slice(0, -1).join("/") + "/";
    const mapJson = (await response.json()) as TiledMap;
    const tileLayer = mapJson.layers.find((layer) => layer.type === "tilelayer") as TiledTileLayer;
    const customTiles = mapJson.layers.find((tileset) => tileset.name === "custom-tiles") as TiledObjectLayer;
    const map = await this.parseMap(mapJson, tileLayer, customTiles, url, name);
    const triggers = await this.parseTriggers(mapJson, rootPath, map);

    return {
      source: mapJson,
      triggers,
      map,
    };
  }

  async parseMap(
    mapJson: TiledMap,
    json: TiledTileLayer,
    customTiles: TiledObjectLayer | undefined,
    assetUrl: string,
    name: string
  ) {
    const tiles: { [key: number]: CustomTile } = {};
    if (mapJson.orientation === "isometric") {
      const GameTile = await this.parseWall(mapJson, assetUrl);
      this.mapTiles[name] = GameTile;
      tiles[0] = {
        name: name,
        width: mapJson.width / 20,
        height: mapJson.height / 20,
      };
      json.data = json.data.map(() => {
        return 0;
      });
    } else {
      if (customTiles) {
        for (const object of customTiles.objects) {
          if (!object.visible) {
            continue;
          }
          const x = Math.floor(object.x / mapJson.tilewidth);
          const y = Math.floor(object.y / mapJson.tileheight);
          const index = x + y * json.width;

          let width = Math.ceil(object.width / mapJson.tilewidth);
          let height = Math.ceil(object.height / mapJson.tileheight);
          if (Math.round(object.x / mapJson.tilewidth) > Math.floor(object.x / mapJson.tilewidth)) {
            width += 1;
          }
          if (Math.round(object.y / mapJson.tileheight) > Math.floor(object.y / mapJson.tileheight)) {
            height += 1;
          }

          tiles[index] = {
            name: object.name,
            width,
            height,
          };
        }
      }
    }
    return {
      data: json.data,
      height: json.height,
      width: json.width,
      customTiles: tiles,
    };
  }

  async parseTriggers(json: TiledMap, rootPath: string, map: MapData): Promise<GameTrigger[]> {
    const data = JSON.parse(JSON.stringify(json)) as TiledMap;
    const triggers = data.layers.find((layer) => layer.name === "triggers") as TiledObjectLayer;
    if (triggers) {
      triggers.objects.forEach((trigger) => {
        let centerX = trigger.width / 2;
        let centerY = trigger.height / 2;
        let scalerX = json.tilewidth;
        let scalerY = json.tileheight;

        if (json.orientation === "isometric") {
          centerX = -trigger.width / 2;
          centerY = -trigger.height / 2;
          scalerX = 640;
          scalerY = 640;
        }
        if (trigger.name.toLowerCase() === "cameraboundary") {
          if (trigger.height > trigger.width) {
            centerY = 0;
            trigger.width = 0;
          } else {
            centerX = 0;
            trigger.height = 0;
          }
        }
        trigger.x = (trigger.x + centerX) / scalerX;
        trigger.y = (trigger.y + centerY) / scalerY;
      });
      const triggerPromises = triggers.objects.map(async (trigger: TiledObject) => {
        if ((!trigger.properties || trigger.properties.length === 0) && trigger.gid === undefined) {
          return null;
        }

        const properties = trigger.properties
          ? await Promise.all(
              trigger.properties.map((prop) => {
                if (prop.name === "fromFile") {
                  return sharedFetch(rootPath + prop.value)
                    .then((response) => response.json())
                    .then((json) => ({
                      name: prop.name,
                      value: json,
                    }));
                }
                return prop;
              })
            )
          : [];

        const propertyFlatMap =
          properties?.reduce((acc: any, prop) => {
            if (prop.name === "fromFile") {
              return { ...prop.value, ...acc };
            }
            acc[prop.name] = prop.value;
            return acc;
          }, {}) ?? {};

        const forcedComponents: string[] = [];

        const propertyMap = Object.entries(propertyFlatMap).reduce((acc: any, prop) => {
          // convert dot notation to nested object
          const [key, value] = prop;
          if (key.includes(".")) {
            const keys = key.split(".");
            let current = acc;
            for (let i = 0; i < keys.length; i++) {
              const key = keys[i];
              if (i === keys.length - 1) {
                current[key] = value;
              } else {
                if (!current[key]) {
                  current[key] = {};
                }
                current = current[key];
              }
            }
          } else {
            if (key[0] === key[0].toUpperCase() && typeof value === "boolean") {
              if (value === true) {
                forcedComponents.push(key);
              }
            } else {
              acc[key] = value;
            }
          }
          return acc;
        }, {});

        if (propertyMap.disabled === true || !trigger.visible) {
          return null;
        }

        let triggerType = propertyMap.trigger?.event ?? "UNKNOWN";

        if (triggerType === "UNKNOWN" && trigger.name.toLowerCase() === "cameraboundary") {
          triggerType = "CAMERABOUNDARY";
        }

        let width = trigger.width / json.tilewidth;
        let height = trigger.height / json.tileheight;
        if (triggerType === "UNKNOWN" && trigger.gid !== undefined) {
          triggerType = "MAPENTITY";
          width = trigger.width;
          height = trigger.height;
          const tiledImage = this.getTiledImageFromGid(trigger.gid, rootPath, json);
          forcedComponents.push("MapSprite");
          propertyMap.MapSprite = {
            name: tiledImage.tileImage?.name,
            flipHorizontal: tiledImage.horizontal,
            flipVertical: tiledImage.vertical,
            visible: propertyMap.MapSprite?.visible ?? true,
          };
        }

        const components: any[] = [];

        if (forcedComponents.length) {
          forcedComponents.forEach((key) => {
            if (!propertyMap[key]) {
              components.push({ type: key });
            } else {
              components.push({ type: key, ...propertyMap[key] });
            }
          });
        }

        return {
          type: triggerType,
          name: propertyMap.trigger?.name ?? trigger.name,
          condition: propertyMap.trigger?.condition ?? {},
          components: components,
          x: trigger.x,
          y: trigger.y,
          width: width,
          height: height,
          properties: propertyMap,
        } as GameTrigger;
      });
      return (await Promise.all(triggerPromises as any)).filter((trigger) => trigger !== null);
    }
    return [];
  }

  public async loadSkin(name: string, url: string): Promise<void> {
    const response = await sharedFetch(url);
    const mapJson = (await response.json()) as MapSkinJson;
    const urlFolder = url.substring(0, url.lastIndexOf("/") + 1);

    const wallPromises: any = [];
    for (const wall of mapJson.walls) {
      const wallUrl = `${urlFolder}/${wall}.json`;
      wallPromises.push(this.loadMapTile(wall, wallUrl));
    }
    await Promise.all(wallPromises);

    const floors = mapJson.floor.stamp ? await this.parseFloor(mapJson.name, mapJson.floor, urlFolder) : [];

    this.mapFloors[name] = floors;
    this.skins[name] = mapJson;
  }

  public async loadMapTile(name: string, url: string): Promise<void> {
    const response = await sharedFetch(url);
    const mapJson = (await response.json()) as TiledMap;
    const GameTile = await this.parseWall(mapJson, url);
    this.mapTiles[name] = GameTile;
  }

  async parseWall(json: TiledMap, assetUrl: string): Promise<GameTile> {
    const wall = {
      tilesets: [],
      layers: [],
      imageData: null,
      center: { x: 0, y: 0 },
      padding: { x: 0, y: 0 },
      sprites: [],
    } as GameTile;
    const urlPath = assetUrl.substring(0, assetUrl.lastIndexOf("/"));

    const tileSets = await Promise.all(json.tilesets.map((tileset) => this.loadTileset(tileset, urlPath)));
    wall.tilesets = tileSets;

    for (const layer of json.layers) {
      if (layer.type === "objectgroup") {
        for (const object of (layer as TiledObjectLayer).objects) {
          if (object.polygon) {
            // get boundingbox
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (const point of object.polygon) {
              minX = Math.min(minX, point.x);
              minY = Math.min(minY, point.y);
              maxX = Math.max(maxX, point.x);
              maxY = Math.max(maxY, point.y);
            }

            object.width = maxX - minX;
            object.height = maxY - minY;
          }
        }
      }
      wall.layers.push(layer as any);
    }

    wall.layers.forEach((layer) => {
      if (layer.type !== "objectgroup" && layer.name !== "walls") {
        this.parseSprites(json, assetUrl, urlPath, layer, wall.tilesets, wall.sprites);
      }
    });

    return wall;
  }

  getTiledImageFromGid(gid: number, urlPath: string, map: TiledMap) {
    const horizontalFlag = !!(gid & rotationMasks.horizontal);
    const verticalFlag = !!(gid & rotationMasks.vertical);
    let tile = gid & ~(rotationMasks.diagonal | rotationMasks.horizontal | rotationMasks.vertical);

    const tilesetInfo = map.tilesets.find((tileset, index) => {
      const nextFirstGid = map.tilesets[index + 1]?.firstgid ?? Infinity;
      return tile >= tileset.firstgid && tile < nextFirstGid;
    });
    tile -= tilesetInfo?.firstgid ?? 0;
    if (tilesetInfo?.firstgid !== 1) {
      tile -= 1;
    }

    if (!tilesetInfo) {
      return {
        tileImage: null,
        horizontal: horizontalFlag,
        vertical: verticalFlag,
        tileset: null,
      };
    }

    const path = url.resolve(urlPath, tilesetInfo.source!) as string;
    const tileset = this.tilesets[path];

    if (!tileset) {
      return {
        tileImage: null,
        horizontal: horizontalFlag,
        vertical: verticalFlag,
        tileset: null,
      };
    }

    // Adjust tile index based on firstgid
    const adjustedTileIndex = tile;

    let tileImage;
    if (adjustedTileIndex === -1) {
      // Single image tileset
      tileImage = tileset.images[0];
    } else {
      // Multi-image tileset
      tileImage = tileset.images[adjustedTileIndex];
    }

    if (!tileImage) {
      throw new Error("Tile not found");
    }

    return {
      tileImage: tileImage,
      horizontal: horizontalFlag,
      vertical: verticalFlag,
      tileset: tileset,
    };
  }

  async loadTileset(tileset: TiledTileset, urlPath: string): Promise<Tileset> {
    const path = url.resolve(urlPath, tileset.source!) as string;
    if (this.tilesetPromises[path] !== undefined) {
      return this.tilesetPromises[path];
    }
    this.tilesetPromises[path] = this.parseTileset(tileset, urlPath);
    return this.tilesetPromises[path];
  }

  async parseTileset(tiledTileset: TiledTileset, urlPath: string): Promise<Tileset> {
    const tileset = {
      firstgid: tiledTileset.firstgid,
      images: {},
    } as Tileset;
    if (!tiledTileset.source) {
      throw new Error("Tileset source is missing");
    }
    const sourceDirectory = tiledTileset.source.split("/").slice(0, -1).join("/") + "/";
    const path = url.resolve(urlPath, tiledTileset.source) as string;

    const source = await sharedFetch(path);
    const json = (await source.json()) as any;

    if (json.tiles) {
      tileset.type = "imagegroup";
      await Promise.all(
        json.tiles.map(async (tile: any) => {
          let imageSrc = tile.image;
          if (imageSrc.startsWith("./")) {
            imageSrc = imageSrc.substring(2);
          }

          const imagePath = `${urlPath}${sourceDirectory}${imageSrc}`;
          const name = `${sourceDirectory}${imageSrc}`.replaceAll("/", "__").replaceAll(".", "_");
          const image = await ImageLoader.getInstance().loadImage(name, imagePath, { skipPixi: false });

          const rawZindexes =
            tile.objectgroup?.objects.sort(({ x: xa }: { x: number }, { x: xb }: { x: number }) => xa - xb) ?? [];

          const zIndexes: any[] = [];

          let x = 0;

          if (rawZindexes.length === 1) {
            zIndexes[0] = { x: 0, y: rawZindexes[0].y, width: tile.imagewidth };
          } else if (rawZindexes.length > 1) {
            for (let i = 0; i < rawZindexes.length - 1; i++) {
              const zIndex = rawZindexes[i];
              const nextZIndex = rawZindexes[i + 1];
              const width = Math.floor(nextZIndex.x) - x;
              zIndexes.push({
                x: x,
                y: zIndex.y,
                width: width,
              });

              x += width;
            }

            zIndexes.push({
              x: x,
              y: rawZindexes[rawZindexes.length - 1].y,
              width: tile.imagewidth - x,
            });
          }

          for (let i = 0; i < rawZindexes.length; i++) {
            const zIndexObject = rawZindexes[i];
            rawZindexes[i] = {
              x: Math.floor(x),
              y: zIndexObject.y,
              width: zIndexObject.width,
            };
          }

          const tileImage = {
            image,
            name,
            width: tile.imagewidth,
            height: tile.imageheight,
            zIndexes: zIndexes,
            xOffset: 0,
            yOffset: 0,
          };
          tileset.images[tile.id] = tileImage;
        })
      );
    } else {
      let imageSrc = json.image;
      if (imageSrc.startsWith("./")) {
        imageSrc = imageSrc.substring(2);
      }
      tileset.type = "tileset";
      const imagePath = `${urlPath}${sourceDirectory}${imageSrc}`;

      const name = `${sourceDirectory}${imageSrc}`.replaceAll("../", "__").replaceAll("/", "__");
      const image = await ImageLoader.getInstance().loadImage(name, imagePath, { skipPixi: false });

      const tileImage = {
        image,
        name,
        width: json.tilewidth,
        height: json.tileheight,
        zIndexes: [],
      };
      for (let i = 0; i < json.tilecount; i++) {
        const row = Math.floor(i / json.columns);
        const col = i % json.columns;
        const x = col * json.tilewidth;
        const y = row * json.tileheight;
        tileset.images[i] = {
          ...tileImage,
          xOffset: x,
          yOffset: y,
        };
      }
    }

    this.tilesets[path] = tileset;

    return tileset;
  }

  public parseSprites(
    json: TiledMap,
    assetUrl: string,
    urlPath: string,
    layer: TiledTileLayer,
    tilesets: Tileset[],
    spriteList: any[]
  ) {
    if (layer.name === "wall") {
      return;
    }
    const x_start = (20 / 2) * json.tilewidth;
    const y_start = (20 / 2) * json.tileheight;

    if (json.orientation === "orthogonal") {
      this.canvas.width = json.width * json.tilewidth;
      this.canvas.height = json.height * json.tileheight;
      const context = this.canvas.getContext("2d")!;
      context.clearRect(0, 0, this.canvas.width, this.canvas.height);

      for (let y = 0; y < layer.height; y++) {
        for (let x = 0; x < layer.width; x++) {
          const tile = layer.data[y * layer.width + x];
          if (tile === 0) continue;

          const { horizontal, vertical, tileset, tileImage } = this.getTiledImageFromGid(tile, urlPath, json);
          if (tileImage) {
            const screenX = x * json.tilewidth;
            const screenY = y * json.tileheight;

            context.drawImage(
              tileImage.image.image,
              tileImage.xOffset,
              tileImage.yOffset,
              tileImage.width,
              tileImage.height,
              screenX,
              screenY,
              tileImage.width,
              tileImage.height
            );
          }
        }
      }

      const imageData = new Image();
      imageData.src = this.canvas.toDataURL();
      const assetName = assetUrl.replaceAll("/", "__").replaceAll(".", "_");
      ImageLoader.getInstance().loadImage(assetName, imageData.src, { skipPixi: false });
      spriteList.push({
        image: imageData,
        name: assetName,
        x: 0,
        y: 0,
        width: json.width * json.tilewidth,
        height: json.height * json.tileheight,
        hFlip: false,
        vFlip: false,
        zIndexes: [],
      });

      return;
    }

    for (let y = 0; y < layer.height; y++) {
      for (let x = 0; x < layer.width; x++) {
        const tile = layer.data[y * layer.width + x];
        if (tile === 0) continue;

        const { horizontal, vertical, tileset, tileImage } = this.getTiledImageFromGid(tile, urlPath, json);

        if (!tileset) continue;
        if (!tileImage) continue;

        const screenX = x_start + ((x - y) * json.tilewidth) / 2;
        const screenY = y_start + ((x + y) * json.tileheight) / 2 - tileImage.image.image.height;

        const sprite = {
          image: tileImage.image.image,
          name: tileImage.name,
          x: screenX,
          y: screenY,
          width: tileImage.image.image.width,
          height: tileImage.image.image.height,
          hFlip: horizontal,
          vFlip: vertical,
          zIndexes: tileImage.zIndexes,
        };

        spriteList.push(sprite);
      }
    }
  }

  loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        resolve(image);
      };
      image.onerror = (err) => {
        console.error(url, err);
        reject(err);
      };
      image.src = url;
    });
  }

  async parseFloor(
    name: string,
    {
      stamp,
      density,
      stampColor,
      isometric,
    }: { stamp: string; density: number; stampColor: string; isometric?: boolean },
    urlFolder: string
  ): Promise<IsometricFloor[]> {
    const imagePath = `${urlFolder}${stamp}`;

    const image = await this.loadImage(imagePath);
    // const image = await ImageLoader.getInstance().loadImage(stamp, imagePath, { skipPixi: true });
    const floors = [];
    const floorPromises = [];
    for (let i = 0; i < 5; i++) {
      const [imageData] = this.generateFloor({
        stamp: image,
        seed: Math.random() * 100,
        density,
        stampColor,
        isometric,
      });
      floors.push({
        imageData: imageData as HTMLImageElement,
        center: { x: 0, y: 0 },
      });
      floorPromises.push(ImageLoader.getInstance().loadImage(`${name}_floor_${i}`, imageData?.src));
    }
    await Promise.all(floorPromises);
    return floors;
  }

  generateFloor({
    stamp,
    seed,
    density,
    stampColor,
    isometric,
  }: {
    stamp: HTMLImageElement;
    seed: number;
    density: number;
    stampColor: string;
    isometric?: boolean;
  }): [HTMLImageElement, number, number] {
    if (isometric) {
      this.canvas.width = 968;
      this.canvas.height = 516;
    } else {
      this.canvas.width = 640;
      this.canvas.height = 640;
    }

    const rgb = hexToRgb(stampColor) as { r: number; g: number; b: number };

    const ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;
    let dx = 0,
      dy = 0;
    ctx.save();
    if (isometric) {
      ctx.translate(484, 32);
      ctx.scale(1, 0.5);
      ctx.rotate((45 * Math.PI) / 180);
    }
    // // change projection to isometric view
    // ctx.translate(484, 32);
    // ctx.scale(1, 0.5);
    // ctx.rotate((45 * Math.PI) / 180);

    const count = 10 * density;
    const size = 64 / density;

    const positions = [];

    // ctx.fillStyle = "white";
    // ctx.fillRect(0, 0, count * size, count * size);

    // ctx.globalAlpha = 0.65;
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        ctx.strokeStyle = "#FFF";
        // ctx.strokeRect(dx, dy, size, size);
        positions.push({ x: dx, y: dy });

        let out = noise.simplex2(dx / 180 + seed * 3, dy / 180 + seed * 2);
        out = out * 0.15 + 0.85;

        const cx = dx + Math.random() * size,
          cy = dy + Math.random() * size,
          // Radii of the white glow.
          innerRadius = size * Math.random() * 0.25,
          outerRadius = size * (Math.random() * 0.5 + 0.5);

        const gradient = ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, outerRadius);
        gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.65)`);
        gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, outerRadius, 0, 2 * Math.PI);
        ctx.fill();

        dx += size;
      }
      dx = 0;
      dy += size;
    }
    // randomize array
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    ctx.globalAlpha = 0.25;
    positions.forEach((pos) => {
      ({ x: dx, y: dy } = pos);
      let out = noise.simplex2(dx / 180, dy / 180);
      const rotation = noise.simplex2(dx, dy) * 360;
      out = out * 0.25 + 0.75;
      ctx.fillStyle = `rgb(${125 + out * 130}, ${125 + out * 130}, ${125 + out * 130})`;
      ctx.translate(dx + size / 2, dy + size / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(stamp, -size / 2, -size / 2, size * 2 * out, size * 2 * out);
      ctx.rotate((-rotation * Math.PI) / 180);
      ctx.translate(-dx - size / 2, -dy - size / 2);
    });

    ctx.restore(); // back to orthogonal projection

    // Now, figure out which tile is under the mouse cursor... :)

    const image = new Image();
    image.src = this.canvas.toDataURL();
    return [image, this.canvas.width, this.canvas.height];
  }
}
