# Changelog

## Unreleased



### "Unsure" no longer strengthens a fading fact

0.6.0's question told an agent that couldn't tell to answer still true, and
that answer wakes the fact as if recalled, so doubt became the old value's
strength. A fading fact now takes a fourth answer, unsure: the question closes
and the memory is left exactly as it was, going on fading unless it's used.
Still true is for when the agent knows. Upkeep gives a question still waiting
in 0.6.0's words the new ones.
