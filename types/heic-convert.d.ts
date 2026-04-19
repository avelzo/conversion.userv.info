declare module 'heic-convert' {
  export interface ConvertOptions {
    buffer: Buffer;
    format: 'JPEG' | 'PNG' | 'HEIC' | 'AVIF' | string;
    quality?: number;
  }

  export default function convert(options: ConvertOptions): Promise<Buffer>;
}
