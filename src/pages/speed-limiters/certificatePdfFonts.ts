import { Font } from "@react-pdf/renderer";
// The *complete* family, not the @fontsource subsets the screen uses: a PDF
// embeds one font per family, and the registration line mixes Arabic, Latin
// and the NBSPs that hold phone digit groups together, so a subset that
// covers only one script prints notdef boxes for the rest.
import regular from "@ibm/plex-sans-arabic/fonts/complete/woff/IBMPlexSansArabic-Regular.woff?url";
import semibold from "@ibm/plex-sans-arabic/fonts/complete/woff/IBMPlexSansArabic-SemiBold.woff?url";
import bold from "@ibm/plex-sans-arabic/fonts/complete/woff/IBMPlexSansArabic-Bold.woff?url";

let registered = false;

/** Idempotent: re-registering the same family throws in react-pdf. */
export function registerCertificateFonts() {
  if (registered) return;
  Font.register({
    family: "Plex",
    fonts: [
      { src: regular },
      { src: semibold, fontWeight: "semibold" },
      { src: bold, fontWeight: "bold" },
    ],
  });
  // A certificate is a fixed legal form; hyphenating a chassis number or a
  // trade name across a line break would be wrong.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
