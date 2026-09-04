import { NextRequest, NextResponse } from "next/server";

function naturalizeDates(value: string) {
  return value.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_match, year, month, day) => {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return new Intl.DateTimeFormat("es-CO", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  });
}

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
    const spokenText = naturalizeDates(String(body.text || "").slice(0, 1500));
    const audio = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "marin", input: spokenText, instructions: "Habla en español latinoamericano, con voz humana, cálida, pausada y tranquilizadora. Pronuncia las fechas como frases naturales, nunca como una serie de números." }),
    });
    if (!audio.ok) return NextResponse.json({ error: "No se pudo generar la voz." }, { status: 502 });
    return new NextResponse(await audio.arrayBuffer(), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  }

  const content: unknown[] = [{ type: "input_text", text: body.action === "scan"
    ? `Lee cuidadosamente el frente y cualquier texto visible del empaque. Devuelve solamente JSON válido: {"name":"", "strength":"", "presentation":"", "package_quantity":null, "warning":""}. name es el nombre comercial o genérico; strength incluye número y unidad; package_quantity es solo la cantidad de tabletas/cápsulas si resulta legible. No inventes información.`
    : body.action === "schedule"
      ? `${system}\n\nPropón únicamente horarios de organización para la frecuencia indicada, usando la rutina y comidas proporcionadas. No cambies la frecuencia ni interpretes instrucciones ambiguas. Si el médico indicó una relación con alimentos, respétala; si no la indicó, no la inventes. Distribuye las tomas razonablemente durante las horas despierto. Devuelve solamente JSON válido: {"times":["HH:MM"],"explanation":"explicación breve y advertencia de confirmación"}. Datos:\n${JSON.stringify(body.context || {})}`
      : body.action === "medicine_info"
        ? `${system}\n\nConsulta fuentes oficiales para explicar este medicamento en español sencillo. Organiza la respuesta con estos títulos: Qué es y para qué suele usarse; Efectos secundarios frecuentes; Señales importantes; Alimentos y precauciones; Propuesta para organizarlo con la rutina; Qué confirmar con el médico o farmacéutico. No diagnostiques, no recomiendes cambiar o suspender una dosis y no presentes la propuesta horaria como instrucción médica. Si la marca o formulación exacta no se puede verificar, dilo. Ten en cuenta que el paciente está en Colombia y que el etiquetado puede variar por país. Datos:\n${JSON.stringify(body.context || {})}`
        : `${system}\n\nHoy es ${body.context?.today || "la fecha indicada"}. Escribe todas las fechas con día de la semana, día, mes en palabras y año; nunca muestres YYYY-MM-DD. Contesta exactamente la pregunta usando estos datos. Los registros en logs representan dosis registradas como tomadas. La ausencia de un registro no demuestra que la persona no tomó la medicina: puedes decir que no aparece registrada o que figura pendiente en la aplicación, pero jamás digas que debe tomarla. Indica revisar el pastillero o consultar al cuidador antes de tomar una dosis sin registro.\n${JSON.stringify(body.context || {})}\n\nPregunta: ${String(body.question || "")}` }];
  if (body.action === "scan" && body.image) content.push({ type: "input_image", image_url: body.image, detail: "high" });

  const requestBody: Record<string, unknown> = { model: "gpt-4.1-mini", instructions: system, input: [{ role: "user", content }], temperature: 0.2, store: false };
  if (body.action === "medicine_info") {
    requestBody.tools = [{
      type: "web_search",
      filters: { allowed_domains: ["medlineplus.gov", "dailymed.nlm.nih.gov", "fda.gov", "invima.gov.co"] },
      search_context_size: "medium",
    }];
    requestBody.tool_choice = "required";
    requestBody.include = ["web_search_call.action.sources"];
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const data = await response.json();
  if (!response.ok) return NextResponse.json({ error: "No se pudo consultar Alivia." }, { status: 502 });
  const rawText = data.output_text || data.output?.flatMap((x: any) => x.content || []).find((x: any) => x.type === "output_text")?.text || "";
  const text = naturalizeDates(rawText);
  if (body.action === "scan" || body.action === "schedule") {
    try { return NextResponse.json({ result: JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")) }); }
    catch { return NextResponse.json({ result: { warning: "Revisa manualmente la información", raw: text } }); }
  }
  if (body.action === "medicine_info") {
    const sources: {url:string;title:string}[] = [];
    for (const item of data.output || []) {
      for (const source of item.action?.sources || []) {
        if (source.url) sources.push({ url: source.url, title: source.title || "Fuente oficial" });
      }
      for (const block of item.content || []) {
        for (const annotation of block.annotations || []) {
          const citation = annotation.url_citation || annotation;
          if (citation.url) sources.push({ url: citation.url, title: citation.title || "Fuente oficial" });
        }
      }
    }
    const unique = Array.from(new Map(sources.map(x => [x.url, x])).values()).slice(0, 6);
    return NextResponse.json({ answer: text, sources: unique });
  }
  return NextResponse.json({ answer: text });
}
