// Embeds build/icon.ico into a Windows .exe file using resedit (pure JS,
// no symlink permissions required). Used as a fallback because
// electron-builder's built-in icon embedding requires winCodeSign extraction
// which fails on Windows without Developer Mode or admin privileges.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NtExecutable, NtExecutableResource, Data, Resource } from 'resedit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function embedIcon(exePath, icoPath) {
  console.log(`  embedding ${path.basename(icoPath)} -> ${path.basename(exePath)}`);
  const exeBuf = await fs.readFile(exePath);
  const icoBuf = await fs.readFile(icoPath);

  const exe = NtExecutable.from(exeBuf);
  const res = NtExecutableResource.from(exe);

  // Parse the ICO file into icon entries
  const iconFile = Data.IconFile.from(icoBuf.buffer.slice(
    icoBuf.byteOffset,
    icoBuf.byteOffset + icoBuf.byteLength,
  ));

  // Replace icon resource group 1 with our icons
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    1033, // LANG_ENGLISH_US (the language is required, but icons work cross-language)
    iconFile.icons.map((item) => item.data),
  );

  // Also update file version / product version info if present
  const viList = Resource.VersionInfo.fromEntries(res.entries);
  for (const vi of viList) {
    vi.setFileVersion(0, 2, 0, 0);
    vi.setProductVersion(0, 2, 0, 0);
    vi.setStringValues(
      { lang: 1033, codepage: 1200 },
      {
        ProductName: 'Editor de PDF',
        FileDescription: 'Editor de PDF',
        CompanyName: 'Marco',
        LegalCopyright: '',
        OriginalFilename: path.basename(exePath),
      },
    );
    vi.outputToResourceEntries(res.entries);
  }

  res.outputResource(exe);
  const out = exe.generate();
  await fs.writeFile(exePath, Buffer.from(out));
  console.log(`  done`);
}

async function main() {
  const icoPath = path.join(ROOT, 'build', 'icon.ico');
  const args = process.argv.slice(2);
  if (args.length === 0) {
    // IMPORTANT: only embed in the actual app .exe inside the unpacked folder.
    // Modifying the NSIS installer .exe or the portable wrapper .exe AFTER
    // electron-builder has packaged them breaks their integrity check
    // ("Installer integrity check has failed"). The NSIS installer's own
    // icon is set by NSIS at build time via the installerIcon config —
    // we don't need (and must not) modify that .exe post-hoc.
    const target = path.join(ROOT, 'release', 'win-unpacked', 'Editor de PDF.exe');
    try {
      await fs.access(target);
      await embedIcon(target, icoPath);
    } catch (e) {
      console.log(`  skip ${target} (${e.message})`);
    }
  } else {
    // Explicit: embed in whatever paths the caller specifies.
    for (const arg of args) {
      await embedIcon(path.resolve(arg), icoPath);
    }
  }
  console.log('Icono embebido en la app desempaquetada.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
