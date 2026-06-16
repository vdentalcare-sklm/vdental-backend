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

async function sendToMeta(body: object): Promise<{ message_id?: string }> {
  const res = await fetch(getWhatsAppUrl(), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Meta API error:', JSON.stringify(data));
    throw new Error(data?.error?.message ?? `Meta API returned ${res.status}`);
  }

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
 * Sends a generic interactive list message.
 * Used for branch selection, date selection and time slot selection.
 */
export async function sendToMetaList(
  to: string,
  options: {
    header: string;
    body: string;
    footer: string;
    buttonLabel: string;
    sectionTitle: string;
    rows: { id: string; title: string; description?: string }[];
  }
) {
  return sendToMeta({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: { type: 'text', text: options.header },
      body: { text: options.body },
      footer: { text: options.footer },
      action: {
        button: options.buttonLabel,
        sections: [
          {
            title: options.sectionTitle,
            rows: options.rows,
          },
        ],
      },
    },
  });
}

/**
 * Sends the time slot selection list.
 * IDs carry branchId so the webhook can route and lock the correct row.
 */
export async function sendSlotSelectionList(
  to: string,
  slots: { id: number; time: string }[],
  date: string,
  branchId: number,
  startIndex: number = 0
) {
  const batch = slots.slice(startIndex, startIndex + 9);

  const rows = batch.map(slot => ({
    id: `SLOT_${branchId}_${slot.id}`,
    title: slot.time,
    description: 'Tap to book this time',
  }));

  if (slots.length > startIndex + 9) {
    rows.push({
      id: `MORE_${branchId}_${date}_${startIndex + 9}`,
      title: '▶ Show Later Times',
      description: 'View more slots',
    });
  }

  return sendToMetaList(to, {
    header: 'Available Time Slots',
    body: 'Please select your preferred appointment time:',
    footer: 'V Dental Hospitals',
    buttonLabel: 'View Times',
    sectionTitle: startIndex === 0 ? 'Morning Slots' : 'Later Slots',
    rows,
  });
}

/**
 * Sends a pre-approved template message.
 * Used for the booking initiation flow from the website form.
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