<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UserDailyStat extends Model
{
    protected $fillable = [
        'user_id',
        'date',
        'due_count',
        'completed_count',
        'weighted_completed_count',
    ];

    protected function casts(): array
    {
        return [
            'date' => 'date',
            'weighted_completed_count' => 'decimal:4',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
