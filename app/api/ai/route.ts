import { NextRequest, NextResponse } from "next/server";

async function authenticated(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      authorization: `Bearer ${token}`,
    },
  });
  return response.ok;
}

export async function POST(request: NextRequest) {
  if (!(await authenticated(request)))
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!process.env.OPENAI_API_KEY)
    return NextResponse.json({ error: "La IA todavía no está configurada." }, { status: 503 });

  const body = await request.json();
  const system = `Eres Alivia, asistente de organización de medicamentos. Responde en español claro y cálido. Usa únicamente los registros proporcionados. No diagnostiques, no cambies dosis ni tratamientos y nunca indiques tomar una dosis cuando el registro sea incierto. Si falta información, pide revisar la fórmula, el pastillero o consultar al médico/farmacéutico. Diferencia siempre instrucciones médicas de sugerencias de organización.`;

  if (body.action === "speech") {
    const audio = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "marin", input: String(body.text || "").slice(0, 1500), instructions: "Habla en español latinoamericano, con voz humana, cálida, pausada y tranquilizadora." }),
    });
    if (!audio.ok) return NextResponse.json({ error: "No se pudo generar la voz." }, { status: 502 });
    return new NextResponse(await audio.arrayBuffer(), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  }

  const content: unknown[] = [{ type: "input_text", text: body.action === "scan"
    ? `Extrae del empaque: nombre comercial o genérico, concentración, presentación y cantidad del envase. Devuelve JSON válido con las claves name, strength, presentation, package_quantity, warning. No inventes campos ilegibles.`
    : `${system}\n\nDatos del paciente y registros:\n${JSON.stringify(body.context || {})}\n\nPregunta: ${String(body.question || "")}` }];
  if (body.action === "scan" && body.image) content.push({ type: "input_image", image_url: body.image, detail: "high" });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4.1-mini", instructions: system, input: [{ role: "user", content }], temperature: 0.2 }),
  });
  const data = await response.json();
  if (!response.ok) return NextResponse.json({ error: "No se pudo consultar Alivia." }, { status: 502 });
  const text = data.output_text || data.output?.flatMap((x: any) => x.content || []).find((x: any) => x.type === "output_text")?.text || "";
  if (body.action === "scan") {
    try { return NextResponse.json({ result: JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")) }); }
    catch { return NextResponse.json({ result: { warning: "Revisa manualmente la información", raw: text } }); }
  }
  return NextResponse.json({ answer: text });
}
