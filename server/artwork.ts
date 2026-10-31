import { randomInt } from "node:crypto";
import sharp from "sharp";

export type Subject = "bus" | "bicycle" | "car" | "train";
export const labels: Record<Subject, string> = {
  bus: "buses",
  bicycle: "bicycles",
  car: "cars",
  train: "trains",
};
const colors = ["#e2a74a", "#4e899a", "#d46754", "#5e927c", "#7d79ab"];

/** Original procedural illustrations, rasterized so markup never discloses the answer. */
export async function renderTile(subject: Subject): Promise<Buffer> {
  const color = colors[randomInt(colors.length)];
  const shift = randomInt(-10, 11);
  const sky = ["#dbe9ed", "#e5e8da", "#e4e3ed", "#f0e5d7"][randomInt(4)];
  const wheel = (x: number, y = 157, radius = 12) =>
    `<circle cx="${x}" cy="${y}" r="${radius}" fill="#27383e"/><circle cx="${x}" cy="${y}" r="${radius * 0.46}" fill="#dce4e6"/>`;
  let vehicle = "";
  if (subject === "bus")
    vehicle = `<rect x="24" y="96" width="154" height="61" rx="11" fill="${color}"/><path d="M34 143h134" stroke="#f4e9ca" stroke-width="5"/>${[35, 63, 91, 119].map((x) => `<rect x="${x}" y="105" width="22" height="24" rx="3" fill="#314d5b"/>`).join("")}<rect x="148" y="104" width="20" height="46" rx="3" fill="#314d5b"/><path d="M158 106v42" stroke="${color}" stroke-width="2"/>${wheel(56)}${wheel(147)}<rect x="25" y="136" width="7" height="8" rx="2" fill="#faf1bd"/>`;
  if (subject === "car")
    vehicle = `<path d="M25 139l15-10 23-25h62l28 25 24 7v22H25z" fill="${color}"/><path d="M68 110h23v22H49zM98 110h24l23 22H98z" fill="#314d5b"/>${wheel(57)}${wheel(147)}<rect x="165" y="139" width="10" height="6" fill="#faf1bd"/>`;
  if (subject === "bicycle")
    vehicle = `${wheel(49, 148, 29)}${wheel(153, 148, 29)}<g fill="none" stroke="${color}" stroke-width="6" stroke-linejoin="round"><path d="M49 148l31-48 32 48H49l23-36h60l21 36M112 148l24-61h14M80 100l-7-17"/></g><path d="M61 82h24M135 87h19" stroke="#314d5b" stroke-width="6" stroke-linecap="round"/><circle cx="111" cy="148" r="7" fill="#dce4e6"/>`;
  if (subject === "train")
    vehicle = `<path d="M28 89h117q29 0 34 34v32H24V101q0-12 4-12" fill="${color}"/>${[34, 64, 94].map((x) => `<rect x="${x}" y="100" width="23" height="25" rx="3" fill="#314d5b"/>`).join("")}<path d="M134 100h12q17 0 22 25h-34z" fill="#314d5b"/><path d="M26 139h148" stroke="#e9dabc" stroke-width="5"/>${wheel(54, 157, 10)}${wheel(78, 157, 10)}${wheel(137, 157, 10)}${wheel(161, 157, 10)}<path d="M10 171h180M15 177h170" stroke="#707d7d" stroke-width="3"/>`;
  const buildings = [0, 45, 95, 145]
    .map((x) => {
      const h = randomInt(30, 70);
      return `<rect x="${x}" y="${110 - h}" width="${randomInt(25, 42)}" height="${h}" fill="${["#b5c6c5", "#c7cbbf", "#c2cbd2"][randomInt(3)]}"/><path d="M${x + 8} ${120 - h}v10m12-10v10" stroke="#eef0e7" stroke-width="5"/>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 200 200"><rect width="200" height="200" fill="${sky}"/><circle cx="${randomInt(20, 175)}" cy="30" r="17" fill="#fff6d9" opacity=".8"/>${buildings}<rect y="109" width="200" height="91" fill="#b6c2b1"/><path d="M0 149h200v42H0z" fill="#8e9c9e"/><path d="M0 185h200" stroke="#e2e5d9" stroke-dasharray="22 13" stroke-width="3"/><g transform="translate(${shift} 0)">${vehicle}</g><rect width="200" height="200" fill="none" stroke="#fff" stroke-opacity=".15" stroke-width="4"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
