// electron-builder afterPack hook — flips Electron fuses on the packaged binary
// to shrink the attack surface of the shipped app. Fuses are compile-time-style
// flags baked into the Electron executable; they cannot be toggled back by an
// attacker at runtime.
//
// NOTE: this only affects PACKAGED builds (npm run dist). It has no effect in
// `npm run dev`. Verify by packaging and inspecting the binary.

const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

module.exports = async function afterPack(context) {
    const { appOutDir, electronPlatformName, packager } = context;
    const productName = packager.appInfo.productFilename;

    let electronBinary;
    if (electronPlatformName === 'win32') {
        electronBinary = path.join(appOutDir, `${productName}.exe`);
    } else if (electronPlatformName === 'darwin') {
        electronBinary = path.join(appOutDir, `${productName}.app`, 'Contents', 'MacOS', productName);
    } else {
        electronBinary = path.join(appOutDir, productName);
    }

    await flipFuses(electronBinary, {
        version: FuseVersion.V1,

        // ⚠️ RunAsNode MUST stay enabled. The packaged backend is launched via
        // child_process.fork(resources/backend/server.js) in electron.cjs, which
        // relies on ELECTRON_RUN_AS_NODE. Disabling this fuse would silently
        // break LLM correction in the shipped app.
        [FuseV1Options.RunAsNode]: true,

        // Encrypt the cookie store on disk.
        [FuseV1Options.EnableCookieEncryption]: true,

        // Refuse code injection via NODE_OPTIONS or the --inspect CLI flags on
        // the packaged binary.
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,

        // Only load the app's own code from the signed app.asar archive. The
        // forked backend runs as plain Node (RunAsNode) and is unaffected.
        [FuseV1Options.OnlyLoadAppFromAsar]: true,

        // macOS only: re-applies an ad-hoc signature after the binary is edited.
        // No-op on Windows/Linux.
        resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    });

    console.log(`[afterPack] Electron fuses flipped → ${electronBinary}`);
};
