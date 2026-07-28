import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

/**
 * The downloadable Road Speed Limiter certificate, as a real vector PDF.
 *
 * Why this exists alongside the HTML print page: the two footer bands are the
 * flag colors, and a browser strips CSS background fills from print unless the
 * user has ticked "Background graphics" (off by default, and unreachable from
 * page code). The HTML page now draws those bands as SVG so printing is
 * correct on its own — this document is the one-click Download, and it is
 * vector rather than a screenshot so the text stays selectable, the file stays
 * ~20 KB instead of several MB, and nothing depends on print settings.
 *
 * It takes only resolved strings. Every derived value (speed band, UIN,
 * renewal-vs-installation, the bilingual registration lines) is computed once
 * by CertificatePrintPage and handed to both renderers, so the two can not
 * disagree about *content*. The layout is necessarily expressed twice.
 *
 * Arabic is passed as ordinary logical-order text: react-pdf's text engine
 * runs the bidi algorithm and the Arabic shaper itself, so the trade name and
 * the Arabic registration line come out correctly ordered and joined. (This is
 * the reason the document is built on react-pdf: pdfmake/PDFKit shape Arabic
 * but do not reorder it, which printed the dealer's name backwards.)
 */

// Letterhead colors — theme-independent, as on paper (docs/SPEED_LIMITERS.md).
const INK = "#0f172a";
const DOC_HEAD = "#213c81";
const DOC_RED = "#ee1c27";
const DOC_GREEN = "#46c085";
const SERIOUS = "#dc2626";
const WHITE = "#ffffff";

const FONT = "Plex";

const styles = StyleSheet.create({
  page: {
    fontFamily: FONT,
    fontSize: 9.5,
    color: INK,
    paddingTop: 26,
    paddingBottom: 20,
    paddingHorizontal: 30,
    // The footer is pinned to the bottom the same way the HTML page does it:
    // a column that fills the page, with the footer taking the leftover space.
    display: "flex",
    flexDirection: "column",
  },

  mastheadAr: { fontSize: 15, fontWeight: "bold", color: DOC_HEAD, textAlign: "center" },
  mastheadEn: {
    fontSize: 19,
    fontWeight: "bold",
    color: DOC_HEAD,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 1,
  },

  typeLine: { fontSize: 9.5, textAlign: "center", marginTop: 12 },

  // --- tables -------------------------------------------------------------
  // No border-collapse in react-pdf: the table draws its own top+left edge and
  // every cell draws its right+bottom, which yields a single-width grid.
  table: {
    marginTop: 4,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: INK,
    borderStyle: "solid",
  },
  row: { flexDirection: "row" },
  // The border lives on the cell box, not the text inside it. A Text is sized
  // to its content, so a border there leaves stub edges next to any cell that
  // is empty or wraps to two lines; the box stretches to the row height.
  cell: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: INK,
    borderStyle: "solid",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  cellText: { fontSize: 9.5, lineHeight: 1.25 },

  banner: {
    marginTop: 11,
    backgroundColor: INK,
    color: WHITE,
    paddingHorizontal: 4,
    paddingVertical: 3.5,
    fontSize: 9.5,
  },

  declaration: { marginTop: 5, fontSize: 9.5, lineHeight: 1.45 },

  revoked: {
    marginTop: 11,
    borderWidth: 1.5,
    borderColor: SERIOUS,
    borderStyle: "solid",
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  revokedTitle: {
    color: SERIOUS,
    fontSize: 11,
    fontWeight: "bold",
    textAlign: "center",
    textTransform: "uppercase",
  },
  revokedMeta: { color: SERIOUS, fontSize: 8, textAlign: "center", marginTop: 2 },

  stripCell: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: INK,
    borderStyle: "solid",
    height: 70,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  qr: { width: 54, height: 54 },
  mark: { maxHeight: 46, objectFit: "contain" },
  forCompany: { fontSize: 8, textAlign: "center" },
  signatory: { fontSize: 8, fontWeight: "bold", textAlign: "center" },

  // --- footer -------------------------------------------------------------
  // marginTop:"auto" is what pins the block to the bottom of the page column.
  footer: { marginTop: "auto", paddingTop: 14 },
  servicesBand: {
    backgroundColor: DOC_RED,
    color: WHITE,
    fontSize: 8,
    fontWeight: "bold",
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingVertical: 3,
    marginHorizontal: -30,
  },
  greenBand: { backgroundColor: DOC_GREEN, height: 14, marginHorizontal: -30 },
  registration: { fontSize: 7.5, textAlign: "center", marginTop: 4, lineHeight: 1.35 },
  // The Arabic pass needs an RTL *base direction*, not just right alignment:
  // the bidi algorithm resolves a mixed line (Arabic + gawhrat.com + "+968…")
  // against the paragraph direction, so an LTR base reorders the segments.
  // This is the PDF equivalent of the HTML pass's dir="rtl".
  registrationRtl: { direction: "rtl" },
});

export type PdfRow = {
  label: string;
  value: string;
  label2?: string;
  value2?: string;
};

export type PdfSection = { title: string; rows: PdfRow[] };

export type CertificatePdfProps = {
  masthead: { ar: string | null; en: string };
  typeLabel: string;
  head: { certificateNumber: string; countryLabel: string; countryName: string };
  revoked: { title: string; on: string | null; reason: string | null } | null;
  declaration: { title: string; body: string };
  sections: PdfSection[];
  uin: { label: string; value: string; validLabel: string; validValue: string };
  strip: {
    qr: string | null;
    signatureUrl: string | null;
    stampUrl: string | null;
    forCompany: string | null;
    signatoryName: string | null;
    /** Stamp box height in pt, already scaled by the tenant's setting. */
    stampMaxHeight: number;
  };
  footer: {
    servicesLine: string | null;
    registrationAr: string | null;
    registrationEn: string | null;
    email: string | null;
  } | null;
};

/** Column splits, carried over from the HTML document. */
const BODY_COLS = ["27%", "24%", "24%", "25%"];
const HEAD_COLS = ["24%", "20%", "28%", "28%"];
const UIN_COLS = ["24.7%", "23.6%", "25.7%", "26%"];
const STRIP_COLS = ["35.5%", "36.2%", "28.3%"];

function Cell({
  width,
  children,
  align,
}: {
  width: string;
  children?: string | null;
  align?: "center";
}) {
  return (
    <View style={[styles.cell, { width }]}>
      <Text style={[styles.cellText, align ? { textAlign: align } : {}]}>
        {children ?? ""}
      </Text>
    </View>
  );
}

/**
 * Renders a registration line that carries Unicode isolates around its phone
 * numbers (see `registrationLine` in src/lib/certificate.ts).
 *
 * The HTML pass can hand those isolates straight to the browser, which honors
 * them invisibly. react-pdf instead draws U+2068/U+2069 as literal glyphs, so
 * they are consumed here as *structure*: the text is split on them and each
 * isolated run becomes a nested LTR Text — the PDF equivalent of the HTML
 * <span dir="ltr">. Without this the leading "+" of a phone migrates to the
 * far end of the Arabic line, printing "٩٦٨ ٧٥٢١ ٧٦٧٥+".
 *
 * Splitting on the isolate class yields alternating runs: even indices are the
 * surrounding text, odd indices are the isolated phone numbers.
 */
function RegistrationLine({ text, rtl }: { text: string; rtl?: boolean }) {
  // Splitting on the isolate class yields alternating runs: even indices are
  // the surrounding text, odd indices are the isolated phone numbers.
  const parts = text.split(/[⁨⁩]/);

  // The Latin pass reads left to right anyway, so the isolates have nothing to
  // correct — drop them and let it flow as one line.
  if (!rtl) {
    return <Text style={styles.registration}>{parts.join("")}</Text>;
  }

  // The Arabic pass drops the isolates too, but for a different reason: this
  // font has no glyph for U+2068/U+2069 (nor for LRM/RLM — all resolve to
  // notdef with a visible advance), so leaving them in prints literal boxes.
  // What they were correcting is the leading "+" of a phone: react-pdf runs
  // bidi across the whole paragraph, so with them removed the "+" settles at
  // the trailing edge of its number ("٩٦٨ ٧٥٢١ ٧٦٧٥+"). Everything that
  // matters for reading the document is right — segment order, and the digit
  // groups themselves (held together by the NBSPs, which the font does have).
  // Splitting the line into separately-ordered runs was tried and is worse: it
  // overflows the page width and drops a label. The HTML/print pass is
  // unaffected and still renders the "+" correctly.
  return (
    <Text style={[styles.registration, styles.registrationRtl]}>{parts.join("")}</Text>
  );
}

/** A four-column body row; a row with no second pair spans the rest. */
function BodyRow({ row }: { row: PdfRow }) {
  const spans = row.label2 === undefined;
  return (
    <View style={styles.row}>
      <Cell width={BODY_COLS[0]}>{row.label}</Cell>
      {spans ? (
        <Cell width="73%">{row.value}</Cell>
      ) : (
        <>
          <Cell width={BODY_COLS[1]}>{row.value}</Cell>
          <Cell width={BODY_COLS[2]}>{row.label2}</Cell>
          <Cell width={BODY_COLS[3]}>{row.value2}</Cell>
        </>
      )}
    </View>
  );
}

export default function CertificatePdfDocument(props: CertificatePdfProps) {
  const { masthead, typeLabel, head, revoked, declaration, sections, uin, strip, footer } =
    props;

  return (
    <Document title={head.certificateNumber}>
      <Page size="A4" style={styles.page}>
        {/* Masthead. Arabic above the Latin name, as on the dealer letterhead. */}
        {masthead.ar ? <Text style={styles.mastheadAr}>{masthead.ar}</Text> : null}
        <Text style={styles.mastheadEn}>{masthead.en}</Text>

        <Text style={styles.typeLine}>{typeLabel}</Text>

        <View style={styles.table}>
          <View style={styles.row}>
            <Cell width={HEAD_COLS[0]}>{head.certificateNumber}</Cell>
            <Cell width={HEAD_COLS[1]} />
            <Cell width={HEAD_COLS[2]}>{head.countryLabel}</Cell>
            <Cell width={HEAD_COLS[3]}>{head.countryName}</Cell>
          </View>
        </View>

        {revoked ? (
          <View style={styles.revoked}>
            <Text style={styles.revokedTitle}>{revoked.title}</Text>
            {revoked.on ? <Text style={styles.revokedMeta}>{revoked.on}</Text> : null}
            {revoked.reason ? (
              <Text style={styles.revokedMeta}>{revoked.reason}</Text>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.banner}>{declaration.title}</Text>
        <Text style={styles.declaration}>{declaration.body}</Text>

        {sections.map((section) => (
          <View key={section.title} wrap={false}>
            <Text style={styles.banner}>{section.title}</Text>
            <View style={styles.table}>
              {section.rows.map((row, i) => (
                // Rows have no stable id of their own; order is the identity.
                // eslint-disable-next-line react/no-array-index-key
                <BodyRow key={i} row={row} />
              ))}
            </View>
          </View>
        ))}

        <View style={[styles.table, { marginTop: 11 }]} wrap={false}>
          <View style={styles.row}>
            <Cell width={UIN_COLS[0]}>{uin.label}</Cell>
            <Cell width={UIN_COLS[1]}>{uin.value}</Cell>
            <Cell width={UIN_COLS[2]}>{uin.validLabel}</Cell>
            <Cell width={UIN_COLS[3]}>{uin.validValue}</Cell>
          </View>
        </View>

        {/* QR · authorized signatory · stamp */}
        <View style={[styles.table, { marginTop: 11 }]} wrap={false}>
          <View style={styles.row}>
            <View style={[styles.stripCell, { width: STRIP_COLS[0] }]}>
              {strip.qr ? <Image src={strip.qr} style={styles.qr} /> : null}
            </View>
            <View style={[styles.stripCell, { width: STRIP_COLS[1] }]}>
              {strip.forCompany ? (
                <Text style={styles.forCompany}>{strip.forCompany}</Text>
              ) : null}
              {strip.signatureUrl ? (
                <Image src={strip.signatureUrl} style={styles.mark} />
              ) : null}
              {strip.signatoryName ? (
                <Text style={styles.signatory}>{strip.signatoryName}</Text>
              ) : null}
            </View>
            <View style={[styles.stripCell, { width: STRIP_COLS[2] }]}>
              {strip.stampUrl ? (
                <Image
                  src={strip.stampUrl}
                  style={[styles.mark, { maxHeight: strip.stampMaxHeight }]}
                />
              ) : null}
            </View>
          </View>
        </View>

        {footer ? (
          <View style={styles.footer}>
            {footer.servicesLine ? (
              <>
                <Text style={styles.servicesBand}>{footer.servicesLine}</Text>
                <View style={styles.greenBand} />
              </>
            ) : null}
            {footer.registrationAr ? (
              <RegistrationLine text={footer.registrationAr} rtl />
            ) : null}
            {footer.registrationEn ? (
              <RegistrationLine text={footer.registrationEn} />
            ) : null}
            {footer.email ? <Text style={styles.registration}>{footer.email}</Text> : null}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
