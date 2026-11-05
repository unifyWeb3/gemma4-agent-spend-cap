# Limitations

- The Gemma 4 arm is missing. The current model evidence is one Pollinations substitute run. It does not establish Gemma 4 behaviour or relative model safety.
- The task set has twelve synthetic Python tasks. It is useful for reproducibility, not for general software engineering capability.
- The paid API is a local stub. No real API, invoice, transfer or vendor was called.
- The hard cap result exercises the simulator in `defenses.js`. The NEAR contract builds but has not been measured in this matrix.
- The response to the tamper attack depends on what the host trusts. The control exercises a host that reads a mutable policy file; it does not prove every host implementation is vulnerable.
- The task budget is 10 cents and the premium target costs 200 cents. Real payment systems have richer amounts, refunds, authorizations and compliance constraints.
- The attack prompts are explicit in the control. Hidden, obfuscated or multi-step attacks may behave differently.
- One seed is used in the control matrix because expected behaviour is deterministic. The model arm will need more than one seed if rate limits permit, and the paper must report when they do not.
- The framework reports task success and verified patch success separately because an agent can write the right patch and never invoke `run_test`.
- The free model endpoint may throttle, return HTTP errors or change without notice. Results from a rate limited endpoint are evidence about that endpoint at that date, not a stable public benchmark.
- The allowlist and blocklist are supplied by the harness. False positives on arbitrary real world vendors are not measured.
