import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProjectOperations } from "@/lib/assistant/project-operations";

const decimalOrEmpty = z.union([z.string().regex(/^\d+(\.\d+)?$/), z.literal(""), z.number().nonnegative()]);
const changes = z.object({
  position: z.string().max(60).optional(),
  description: z.string().trim().min(2).optional(),
  quantity: decimalOrEmpty.optional(),
  unit: z.string().max(30).optional(),
  estimated_unit_price: decimalOrEmpty.optional(),
});
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params; const value = changes.safeParse(await request.json()); if (!value.success) return NextResponse.json({ error: "Invalid cell value" }, { status: 400 });
  const db = await createSupabaseServerClient(); const { data: { user } } = await db.auth.getUser(); if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const result = await new ProjectOperations(id).editSpecLine({
      itemId,
      newPosition: value.data.position,
      description: value.data.description,
      quantity: value.data.quantity,
      unit: value.data.unit,
      estimatedUnitPrice: value.data.estimated_unit_price,
    });
    return NextResponse.json({ item: result.item });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid cell value" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const db = await createSupabaseServerClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    await new ProjectOperations(id).deleteSpecLineDirect(itemId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete row" }, { status: 400 });
  }
}
