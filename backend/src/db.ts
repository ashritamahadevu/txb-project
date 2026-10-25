import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function seedTemplates() {
  const count = await prisma.goalTemplate.count();
  if (count > 0) return;
  await prisma.goalTemplate.create({
    data: {
      category: "habit",
      title: "Show up",
      description: "Post a photo each time you do the habit. Three proofs close the week.",
      verification: "photo",
      proofsRequired: 3,
    },
  });
}
