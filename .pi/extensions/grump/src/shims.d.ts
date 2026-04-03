declare module "node:fs" {
  export const existsSync: any;
  export const mkdirSync: any;
  export const readFileSync: any;
  export const writeFileSync: any;
}

declare module "node:path" {
  export const join: (...parts: string[]) => string;
  export const dirname: (value: string) => string;
}

declare module "node:url" {
  export const fileURLToPath: (value: string | URL) => string;
}
