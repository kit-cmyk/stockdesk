"use client";

import { LookupManager } from "@/components/LookupManager";
import { useCategories } from "@/lib/hooks";
import { deleteCategory, saveCategory } from "@/lib/repo";

export default function CategoriesPage() {
  const categories = useCategories();
  return (
    <LookupManager
      title="Categories"
      items={categories}
      onSave={({ name, id }) => saveCategory(name, id)}
      onDelete={deleteCategory}
    />
  );
}
