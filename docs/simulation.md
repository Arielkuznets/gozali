# Simulation results

Run: Sep 27, 2026, `npm run sim` in `packages/game-engine`, with the constants of spec version 3.2 (the day rules are unchanged since version 3; the coins column is new).

**The model:** every member feeds on a given day with a fixed probability (`rate`). Rest days are used automatically, and a member who is about to miss uses the month's joker half of the time. Members count from their first feed, and fall asleep and wake up by the rules. In Gym, 0.55 is about 4 workouts a week (the quota with 3 rest days), and 0.4 is fewer than 3.

```text
Gozali simulator: 1000 runs per row, 60 days, seed 1
rate: chance a member feeds on a given day; success: share of counted days that succeeded;
avg health: after hatching, 0 while away; low: days below 40 health or away;
ran away: packs whose critter ran away at least once;
kid, teen: median day the stage was reached; asleep: share of member-days spent asleep;
coins/week: coins the pack earned per week on average over the whole run.

Reading (0 rest days a week)
rate  size  success  avg health  low  ran away  kid  teen  asleep  coins/week
0.75  2     64%      90          0%   0%        10   33    1%      4.7
0.75  3     51%      67          17%  28%       11   39    1%      3.5
0.75  5     71%      56          31%  69%       8    29    1%      5.2
0.75  8     51%      20          75%  100%      10   >60   1%      1.8
0.90  2     86%      98          0%   0%        8    24    0%      9.0
0.90  3     80%      96          0%   0%        8    26    0%      7.2
0.90  5     95%      98          0%   0%        7    22    0%      15.8
0.90  8     89%      93          1%   0%        7    23    0%      10.2
0.97  2     97%      99          0%   0%        7    22    0%      17.5
0.97  3     95%      99          0%   0%        7    22    0%      15.1
0.97  5     100%     99          0%   0%        7    21    0%      25.0
0.97  8     99%      99          0%   0%        7    21    0%      23.3

Study (1 rest days a week)
rate  size  success  avg health  low  ran away  kid  teen  asleep  coins/week
0.70  2     74%      95          0%   0%        9    29    1%      6.2
0.70  3     68%      91          1%   0%        9    30    1%      5.2
0.70  5     85%      90          2%   2%        7    24    1%      8.6
0.70  8     72%      58          28%  73%       8    29    1%      5.2
0.85  2     92%      99          0%   0%        7    23    0%      13.5
0.85  3     91%      98          0%   0%        7    23    0%      11.4
0.85  5     99%      99          0%   0%        7    21    0%      21.8
0.85  8     97%      98          0%   0%        7    21    0%      17.3
0.95  2     99%      99          0%   0%        7    21    0%      23.7
0.95  3     99%      99          0%   0%        7    21    0%      22.9
0.95  5     100%     99          0%   0%        7    21    0%      26.0
0.95  8     100%     99          0%   0%        7    21    0%      25.8

Gym (3 rest days a week)
rate  size  success  avg health  low  ran away  kid  teen  asleep  coins/week
0.40  2     55%      93          0%   0%        16   42    2%      4.1
0.40  3     59%      88          1%   1%        11   36    2%      4.4
0.40  5     76%      84          4%   6%        8    26    2%      6.6
0.40  8     72%      55          31%  88%       8    29    2%      4.8
0.55  2     74%      98          0%   0%        10   30    0%      8.3
0.55  3     80%      97          0%   0%        9    26    0%      8.1
0.55  5     94%      98          0%   0%        7    22    0%      14.6
0.55  8     90%      94          0%   0%        7    23    0%      10.3
0.70  2     89%      99          0%   0%        8    24    0%      16.8
0.70  3     94%      99          0%   0%        7    22    0%      16.9
0.70  5     99%      99          0%   0%        7    21    0%      24.7
0.70  8     99%      99          0%   0%        7    21    0%      22.8
```

## Conclusions

- **D1 meets its criterion.** Good packs (Reading at 90%, Study at 85%, Gym at 55%) never lose the creature at any size, keep an average health of 93–99, and reach Kid on day 7–10.
- **Weak packs decline, and large ones faster.** In Reading at 75%, the creature runs away in 28% of packs of 3, in 69% of packs of 5, and in every pack of 8. The penalty is per member who missed, so a large pack has more misses a day, while the allowed miss stays at one.
- **Packs of 2 are very forgiving.** Even at 75% no creature runs away.
- **Sleep hardly ever triggers** in these packs (up to 2% of member-days), because members who miss also feed often and wake up right away.
- **Coins (decision D21):** a typical pack earns about 8 to 17 coins a week (Reading at 90%, Study at 85%, Gym at 55%), a very consistent one about 23 to 26, and a struggling one 2 to 6. With shop prices of 10 to 45, a good pack buys something every week or two, and the whole shop takes a few months.
- **To check in the pilot:** if large packs wear down too fast in practice, the direction is one allowed miss per 4 members (2 in a pack of 8), or a smaller penalty per miss in large packs. No change for now, because both changes weaken the shared accountability.
