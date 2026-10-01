import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runEstimateAgent } from "@/lib/assistant/estimate-agent";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = z.object({
    message: z.string().trim().min(1).max(2000),
    selectedIds: z.array(z.string().uuid()).max(200).default([]),
    selectionContext: z.string().max(4000).default(""),
    pendingConfirmationId: z.string().uuid().optional(),
    history: z.array(z.object({ role: z.enum(["assistant", "user"]), content: z.string().max(4000) })).max(10).default([]),
  }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  const db = await createSupabaseServerClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    return NextResponse.json(await runEstimateAgent({ ...parsed.data, projectId: id }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось выполнить запрос." }, { status: 400 });
  }
}
