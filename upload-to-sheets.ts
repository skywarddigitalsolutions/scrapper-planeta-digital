import { readFile } from "fs/promises";
import * as path from "path";
import { google } from "googleapis";

// --- Configuración ---
const SPREADSHEET_ID = "1PeMm883Ad99X9X8OTlSwitcgM0laSmAihtyLPtGXNvY";
const SHEET_NAME = "Productos";
const CRED_PATH = path.resolve(
  __dirname,
  "planeta-digital-460621-6ff0f49282c6.json"
);
const GH_USER = "skywarddigitalsolutions";
const GH_REPO = "scrapper-planeta-digital";
const GH_BRANCH = "main";
const PUBLIC_IMG_BASE = `https://raw.githubusercontent.com/${GH_USER}/${GH_REPO}/${GH_BRANCH}/images/`;

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CRED_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const raw = await readFile(
    path.resolve(__dirname, "productos.json"),
    "utf-8"
  );
  const { products } = JSON.parse(raw) as {
    total: number;
    products: {
      name: string;
      category: string;
      price: string;
      description: string;
      image: string;
      images: string[];
    }[];
  };

  const rows = [
    ["Imagen principal", "Nombre", "Categoría", "Precio", "Descripción"],
    ...products.map((p) => {
      const fileName = p.image.split("/").pop();
      const publicUrl = fileName ? PUBLIC_IMG_BASE + fileName : "";

      return [
        publicUrl
          ? `=IMAGE("${publicUrl}"; 4; 100; 100)`
          : "",
        p.name,
        p.category,
        p.price.replaceAll('USD ', ''),
        p.description.replace(/\n/g, " "),
      ];
    }),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });

  console.log(`✅ Volcados ${products.length} productos en ${SHEET_NAME}!`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
