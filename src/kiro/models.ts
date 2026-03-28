export function mapListModelsToOpenAi(json: unknown): { object: "list"; data: unknown[] } {
  return {
    object: "list",
    data: extractModelList(json).map(mapOneModel),
  };
}

function extractModelList(json: unknown): unknown[] {
  if (Array.isArray(json)) {
    return json;
  }

  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    const list = o.models ?? o.modelSummaries ?? o.data;
    if (Array.isArray(list)) {
      return list;
    }
  }

  return [];
}

function mapOneModel(m: unknown): Record<string, unknown> {
  if (typeof m === "string") {
    return { id: m, object: "model", created: 0, owned_by: "kiro" };
  }

  if (m && typeof m === "object") {
    const o = m as Record<string, unknown>;
    const id = o.modelId ?? o.id ?? o.name ?? "unknown";
    return { id: String(id), object: "model", created: 0, owned_by: "kiro" };
  }

  return { id: "unknown", object: "model", created: 0, owned_by: "kiro" };
}
