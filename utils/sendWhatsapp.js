import axios from "axios"; // or `const axios = require("axios")` for CommonJS

export async function sendWhatsAppTemplate(toPhoneE164, values) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  // new LogiQ template : 
  // const data = {
  //   messaging_product: "whatsapp",
  //   to: toPhoneE164,
  //   type: "template",
  //   template: {
  //     name: "logiq_tender_notification",
  //     language: {
  //       code: "hi",
  //     },
  //     components: [
  //       {
  //         type: "header",
  //         parameters: [
  //           {
  //             type: "image",
  //             image: {
  //               link: "https://i.postimg.cc/NGDHK6pc/IMG-20260325-WA0028.jpg",
  //             },
  //           },
  //         ],
  //       },
  //       {
  //         type: "body",
  //         parameters: [
  //           {
  //             type: "text",
  //             text: values.dispatch_location,
  //             parameter_name: "dispatch_location",
  //           },
  //           {
  //             type: "text",
  //             text: values.delivery_from,
  //             parameter_name: "delivery_from",
  //           },
  //           {
  //             type: "text",
  //             text: values.delivery_to,
  //             parameter_name: "delivery_to",
  //           },
  //           {
  //             type: "text",
  //             text: values.start_datetime,
  //             parameter_name: "start_datetime",
  //           },
  //           {
  //             type: "text",
  //             text: values.end_datetime,
  //             parameter_name: "end_datetime",
  //           },
  //         ],
  //       },
  //     ],
  //   },
  // };

  // old RRIspat template 
  const data = {
    messaging_product: "whatsapp",
    to: toPhoneE164,
    type: "template",
    template: {
      name: "logiyatra_tender_notification",
      language: {
        code: "hi",
      },
      components: [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: {
                link: "https://i.postimg.cc/N0sVbVTh/Logi-Yatra-Logo.png",
              },
            },
          ],
        },
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: values.dispatch_location,
              parameter_name: "dispatch_location",
            },
            {
              type: "text",
              text: values.delivery_from,
              parameter_name: "delivery_from",
            },
            {
              type: "text",
              text: values.delivery_to,
              parameter_name: "delivery_to",
            },
            {
              type: "text",
              text: values.start_datetime,
              parameter_name: "start_datetime",
            },
            {
              type: "text",
              text: values.end_datetime,
              parameter_name: "end_datetime",
            },
          ],
        },
      ],
    },
  };
  try {
    const response = await axios.post(url, data, { headers });
    console.log("response in whatsapp", response.data);
    return response.data;
  } catch (error) {
    console.error(
      "❌ Failed to send WhatsApp template:",
      error.response?.data || error.message,
    );
  }
}
