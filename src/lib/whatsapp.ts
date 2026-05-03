// Single place to update when Meta releases a new Graph API version
const GRAPH_API_VERSION = 'v19.0';

const getWhatsAppUrl = () => {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!phoneId) throw new Error('WHATSAPP_PHONE_ID is not defined.');
  return `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneId}/messages`;
};

const getHeaders = () => {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error('WHATSAPP_TOKEN is not defined.');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

/**
 * Helper: sends a request and throws a descriptive error if Meta rejects it.
 */
async function sendToMeta(body: object): Promise<{ message_id?: string }> {
  const res = await fetch(getWhatsAppUrl(), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    // Meta returns structured error details — log them for debugging
    console.error('Meta API error:', JSON.stringify(data));
    throw new Error(data?.error?.message ?? `Meta API returned ${res.status}`);
  }

  // Return the message ID so callers can store it for delivery tracking
  return { message_id: data?.messages?.[0]?.id };
}

/**
 * Sends a plain text message (free within 24-hour user-initiated window).
 */
export async function sendWhatsAppText(to: string, text: string) {
  return sendToMeta({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body: text },
  });
}

/**
 * Sends the interactive slot-selection list (free within 24-hour window).
 * Uses real DB slot IDs so the webhook can lock the correct row.
 */
export async function sendSlotSelectionList(
  to: string,
  slots: { id: number; time: string }[]
) {
  const rows = slots.map(slot => ({
    id: `SLOT_${slot.id}`,       // encodes the real DB id
    title: slot.time,
    description: 'Tap to book this time',
  }));

  return sendToMeta({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: 'Available Appointments' },
      body: { text: 'Please select your preferred time slot.' },
      footer: { text: 'Day & Night Dental Clinic' },
      action: {
        button: 'View Slots',
        sections: [{ title: 'Available Times', rows }],
      },
    },
  });
}

/**
 * Sends a pre-approved marketing template (costs money — used for outreach).
 * Returns the Meta message ID for delivery tracking.
 */
export async function sendOutreachTemplate(
  to: string,
  templateName: string,
  variables: string[]
): Promise<{ message_id?: string }> {
  return sendToMeta({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en' },
      components: [
        {
          type: 'body',
          parameters: variables.map(text => ({ type: 'text', text })),
        },
      ],
    },
  });
}