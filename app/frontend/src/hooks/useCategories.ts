"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiFetchAllPages, ApiError } from "@/lib/api";

export type Category = {
  id: number;
  name: string;
  color: string | null;
  created_at: string;
};

export type CategoryInput = {
  name: string;
  color?: string | null;
};

type UseCategoriesResult = {
  categories: Category[];
  isLoading: boolean;
  error: string | null;
  createCategory: (input: CategoryInput) => Promise<Category>;
  updateCategory: (id: number, input: CategoryInput) => Promise<Category>;
  deleteCategory: (id: number) => Promise<void>;
  reload: () => Promise<void>;
};

export function useCategories(): UseCategoriesResult {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetchAllPages<Category>("/categories");
      setCategories(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar las categorías.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createCategory(input: CategoryInput): Promise<Category> {
    const category = await apiFetch<Category>("/categories", {
      method: "POST",
      body: JSON.stringify(input),
    });
    setCategories((prev) => [...prev, category]);
    return category;
  }

  async function updateCategory(id: number, input: CategoryInput): Promise<Category> {
    const category = await apiFetch<Category>(`/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    setCategories((prev) => prev.map((c) => (c.id === id ? category : c)));
    return category;
  }

  async function deleteCategory(id: number): Promise<void> {
    await apiFetch<null>(`/categories/${id}`, { method: "DELETE" });
    setCategories((prev) => prev.filter((category) => category.id !== id));
  }

  return { categories, isLoading, error, createCategory, updateCategory, deleteCategory, reload: load };
}
