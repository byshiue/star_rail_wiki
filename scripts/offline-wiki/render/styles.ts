export const printStyles = `
@page { size: A4; margin: 18mm 16mm 20mm; }
:root { color-scheme: light; font-family: "Noto Sans CJK SC", "Source Han Sans SC", sans-serif; color: #172033; }
* { box-sizing: border-box; }
body { margin: 0; font-size: 10.5pt; line-height: 1.55; }
a { color: #315b9d; text-decoration: none; }
h1 { color: #263d78; font-size: 25pt; margin: 0 0 8mm; }
h2 { color: #263d78; border-bottom: 1px solid #b9c4d8; padding-bottom: 2mm; }
h3 { margin-bottom: 1.5mm; }
.cover { break-after: page; min-height: 230mm; display: grid; align-content: center; }
.entry { break-before: page; }
.entry:first-of-type { break-before: auto; }
.meta, .source, .missing, .footer { color: #5d6778; font-size: 9pt; }
.image-placeholder { min-height: 38mm; border: 1px dashed #9ba8bd; display: grid; place-items: center; color: #6b7688; }
.entry-image { display: block; max-width: 100%; max-height: 110mm; margin: 3mm auto; object-fit: contain; }
.attribution { text-align: center; color: #6b7688; font-size: 8pt; }
.toc { columns: 2; column-gap: 10mm; }
.toc li { break-inside: avoid; margin-bottom: 1mm; }
.feature { break-inside: avoid; border-left: 2px solid #d6deeb; padding-left: 4mm; margin: 4mm 0; }
.source { border-top: 1px solid #dde3ec; margin-top: 6mm; padding-top: 2mm; overflow-wrap: anywhere; }
.return { text-align: right; }
table { width: 100%; border-collapse: collapse; }
th, td { border-bottom: 1px solid #dde3ec; padding: 2mm; text-align: left; vertical-align: top; }
`;
