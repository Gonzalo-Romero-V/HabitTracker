<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Category\StoreCategoryRequest;
use App\Http\Requests\Category\UpdateCategoryRequest;
use App\Http\Resources\CategoryResource;
use App\Models\Category;
use Illuminate\Http\Request;

class CategoryController extends Controller
{
    public function index(Request $request)
    {
        $categories = Category::where('user_id', $request->user()->id)
            ->orderBy('name')
            ->orderBy('id')
            ->paginate(max(1, min((int) $request->query('per_page', 15), 100)));

        return response()->json([
            'data' => CategoryResource::collection($categories)->resolve(),
            'meta' => [
                'current_page' => $categories->currentPage(),
                'last_page' => $categories->lastPage(),
                'per_page' => $categories->perPage(),
                'total' => $categories->total(),
            ],
        ]);
    }

    public function store(StoreCategoryRequest $request)
    {
        $category = Category::create([
            'user_id' => $request->user()->id,
            'name' => $request->validated('name'),
            'color' => $request->validated('color'),
        ]);

        return response()->json([
            'data' => new CategoryResource($category),
            'mensaje' => 'Categoría creada correctamente.',
        ], 201);
    }

    public function show(Request $request, Category $category)
    {
        $this->authorize('view', $category);

        return response()->json([
            'data' => new CategoryResource($category),
        ]);
    }

    public function update(UpdateCategoryRequest $request, Category $category)
    {
        $this->authorize('update', $category);

        $category->update([
            'name' => $request->validated('name'),
            'color' => $request->validated('color'),
        ]);

        return response()->json([
            'data' => new CategoryResource($category),
            'mensaje' => 'Categoría actualizada correctamente.',
        ]);
    }

    public function destroy(Request $request, Category $category)
    {
        $this->authorize('delete', $category);

        $category->delete();

        return response()->json([
            'data' => null,
            'mensaje' => 'Categoría eliminada correctamente.',
        ]);
    }
}
