export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, mediaType } = req.body;

  if (!image || !mediaType) {
    return res.status(400).json({ error: 'Missing image or mediaType' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: image }
            },
            {
              type: 'text',
              text: `Analizá este recibo y extraé la información en JSON exacto, sin texto adicional, sin markdown:
{
  "datetime": "fecha y hora del recibo en formato legible, ej: Jun 22, 2026 — 8:30 PM",
  "amountOrig": "monto original como número, ej: 87.50",
  "currency": "código de moneda de 3 letras, ej: USD, EUR, MXN",
  "description": "descripción breve del gasto en español",
  "category": "una de estas opciones exactas: Desayuno, Comida, Cena, Cena con cliente, Hotel, Vuelo, Maletas / Equipaje, Taxi / Uber, Renta de auto, Combustible, Estacionamiento, Transporte público, Otro"
}`
            }
          ]
        }]
      })
    });

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error('Error calling Anthropic API:', err);
    return res.status(500).json({ error: 'Failed to analyze receipt' });
  }
}