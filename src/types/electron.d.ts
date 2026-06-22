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

interface OpenedCert {
  name: string;
  data: ArrayBuffer;
}

interface SignOptions {
  reason?: string;
  location?: string;
  contactInfo?: string;
  name?: string;
}

interface DigitalIdInfo {
  commonName: string;
  organization?: string;
  country?: string;
  email?: string;
  years?: number;
}

interface SignatureVerifyResult {
  signed: boolean;
  valid: boolean;
  digestMatches: boolean;
  coversWholeFile: boolean;
  signerCommonName?: string;
  reason?: string;
  signedAt?: string;
  error?: string;
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
  openCert(): Promise<OpenedCert | null>;
  signPdf(
    pdf: ArrayBuffer,
    p12: ArrayBuffer,
    passphrase: string,
    opts?: SignOptions,
  ): Promise<ArrayBuffer | null>;
  createDigitalId(
    info: DigitalIdInfo,
    passphrase: string,
  ): Promise<string | null>;
  verifySignature(pdf: ArrayBuffer): Promise<SignatureVerifyResult | null>;
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
