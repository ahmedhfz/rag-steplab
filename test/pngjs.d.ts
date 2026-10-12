// pngjs ships no types; tests only decode PNG files to check size and alpha.
declare module "pngjs" {
  export class PNG {
    width: number;
    height: number;
    data: Uint8Array;
    static sync: { read(buffer: Uint8Array): PNG; write(png: PNG): Uint8Array };
  }
}
