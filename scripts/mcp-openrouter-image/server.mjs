import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { writeFile } from "fs/promises";
import { resolve } from "path";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error("Missing OPENROUTER_API_KEY env var");
  process.exit(1);
}

const server = new Server(
  { name: "openrouter-image", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "generate_image",
      description:
        "Generate an image using Google Gemini 2.5 Flash Image Preview (Nano Banana) via OpenRouter. Saves the image to a file.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Text description of the image to generate",
          },
          output_path: {
            type: "string",
            description:
              "Absolute path where to save the generated image (e.g. C:/path/to/image.png)",
          },
          width: {
            type: "number",
            description: "Image width (default: 1024)",
            default: 1024,
          },
          height: {
            type: "number",
            description: "Image height (default: 1024)",
            default: 1024,
          },
        },
        required: ["prompt", "output_path"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "generate_image") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { prompt, output_path, width = 1024, height = 1024 } = request.params
    .arguments;

  console.error(`Generating image: "${prompt}" -> ${output_path}`);

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        modalities: ["image", "text"],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Generate an image with these exact dimensions: ${width}x${height} pixels. ${prompt}`,
              },
            ],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `OpenRouter API error ${response.status}: ${errText}`
    );
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;

  // Try to find image in message.images array (OpenRouter format)
  let base64Data;
  if (message?.images && Array.isArray(message.images)) {
    const imagePart = message.images.find(
      (img) => img.image_url?.url?.startsWith("data:image")
    );
    if (imagePart) {
      base64Data = imagePart.image_url.url.split(",")[1];
    }
  }

  // Fallback: try content array
  if (!base64Data) {
    const content = message?.content;
    if (Array.isArray(content)) {
      const imagePart = content.find(
        (part) => part.type === "image_url" || part.type === "image"
      );
      if (imagePart?.image_url?.url?.startsWith("data:image")) {
        base64Data = imagePart.image_url.url.split(",")[1];
      } else if (imagePart?.source?.data) {
        base64Data = imagePart.source.data;
      }
    }
  }

  if (!base64Data) {
    throw new Error("No image data found in response from OpenRouter");
  }

  const buffer = Buffer.from(base64Data, "base64");
  const resolvedPath = resolve(output_path);
  await writeFile(resolvedPath, buffer);

  console.error(`Image saved to ${resolvedPath} (${buffer.length} bytes)`);

  return {
    content: [
      {
        type: "text",
        text: `Image generated successfully and saved to ${resolvedPath} (${buffer.length} bytes)`,
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
