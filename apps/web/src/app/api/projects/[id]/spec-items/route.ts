import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProjectOperations } from "@/lib/assistant/project-operations";

const item = z.object({
  position: z.union([z.string(), z.number()]).optional(), description: z.string().min(1).default("Новая строка"),
  quantity: z.union([z.string(), z.number()]).optional(), unit: z.union([z.string(), z.number()]).optional(),
  estimated_unit_price: z.union([z.string(), z.number()]).optional(),
});
const bodySchema = z.union([item, z.object({ items: z.array(item).max(5000) })]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid rows" }, { status: 400 });
  const db = await createSupabaseServerClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!("items" in parsed.data)) {
    try {
      const result = await new ProjectOperations(id).addSpecLine({
        position: parsed.data.position == null ? "" : String(parsed.data.position),
        description: parsed.data.description,
        quantity: parsed.data.quantity,
        unit: parsed.data.unit == null ? null : String(parsed.data.unit),
        estimatedUnitPrice: parsed.data.estimated_unit_price,
      });
      return NextResponse.json({ item: result.item });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid row" }, { status: 400 });
    }
  }
  const { data: project } = await db.from("projects").select("company_id").eq("id", id).single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const incoming = parsed.data.items;
  const { data: lastItem } = await db.from("spec_items").select("sort_order").eq("project_id", id).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const firstSortOrder = Number(lastItem?.sort_order ?? -1) + 1;
  const records = incoming.map((value, index) => ({
    project_id: id, company_id: project.company_id, created_by: user.id, sort_order: firstSortOrder + index,
    position: value.position == null ? "" : String(value.position), description: value.description,
    quantity: value.quantity === "" ? null : value.quantity, unit: value.unit == null ? "" : String(value.unit),
    estimated_unit_price: value.estimated_unit_price === "" ? null : value.estimated_unit_price,
  }));
  const { data, error } = await db.from("spec_items").insert(records).select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(incoming.length === 1 ? { item: data?.[0] } : { items: data });
}
