interface OpenedFile {
  path: string;
  name: string;
  size: number;
  data: ArrayBuffer;
}

interface OpenedImage {
  path: string;
  name: string;
  data: ArrayBuffer;
}

interface FileFilter {
  name: string;
  extensions: string[];
}

interface ElectronApi {
  openPdf(opts?: { multi?: boolean }): Promise<OpenedFile[] | null>;
  openPdfByPath(filePath: string): Promise<OpenedFile | null>;
  openImage(): Promise<OpenedImage | null>;
  savePdf(defaultName: string, data: ArrayBuffer): Promise<string | null>;
  saveBinary(
    defaultName: string,
    data: ArrayBuffer,
    filters?: FileFilter[],
  ): Promise<string | null>;
  saveFolder(defaultName: string): Promise<string | null>;
  writeFile(filePath: string, data: ArrayBuffer): Promise<boolean>;
  getVersion(): Promise<string>;
  getPlatform(): Promise<string>;
  onMenuEvent(channel: string, callback: () => void): () => void;
  _diagnostics(): {
    preloadLoaded: boolean;
    timestamp: number;
    process: {
      versions: NodeJS.ProcessVersions;
      platform: string;
      arch: string;
    };
  };
}

declare global {
  interface Window {
    api: ElectronApi;
  }
}

export {};
