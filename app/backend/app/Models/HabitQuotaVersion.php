<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HabitQuotaVersion extends Model
{
    protected $fillable = [
        'habit_id',
        'quota_target',
        'quota_period',
        'effective_from',
    ];

    protected function casts(): array
    {
        return [
            'quota_target' => 'integer',
            'effective_from' => 'date',
        ];
    }

    public function habit(): BelongsTo
    {
        return $this->belongsTo(Habit::class);
    }
}
