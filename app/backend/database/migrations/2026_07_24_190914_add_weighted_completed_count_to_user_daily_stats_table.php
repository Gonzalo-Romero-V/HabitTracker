<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('user_daily_stats', function (Blueprint $table) {
            // `completed_count` es un conteo binario (todo-o-nada por
            // HabitLog) — necesario para el resumen "X de Y hábitos" de
            // "Hoy", pero le da crédito cero a un hábito cuantificable que
            // quedó a medio camino de su meta (ej. 8 de 10 vasos de agua no
            // suma nada hoy). Este campo es un índice fraccionario aparte,
            // pensado solo para el score que colorea el heatmap
            // (Calendario/Memento Mori) — nunca reemplaza a completed_count,
            // que sigue siendo la fuente de verdad para conteos exactos.
            $table->decimal('weighted_completed_count', 8, 4)->default(0)->after('completed_count');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('user_daily_stats', function (Blueprint $table) {
            $table->dropColumn('weighted_completed_count');
        });
    }
};
