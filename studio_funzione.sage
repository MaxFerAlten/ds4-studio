# Studio completo della funzione razionale:
#   f(x) = (x^3 - 2x^2 + 1) / (x^2 - 3x + 2)
#
# Passaggi: dominio, simmetrie, zeri, segno, limiti, asintoti,
# derivata prima, monotonia, punti critici, derivata seconda,
# concavità, punti di flesso, grafico.

var('x')
f(x) = (x^3 - 2*x^2 + 1) / (x^2 - 3*x + 2)

print("=== STUDIO COMPLETO DELLA FUNZIONE ===")
print("f(x) =", f)
print()

# 1. DOMINIO
den = x^2 - 3*x + 2
dom_excl = solve(den == 0, x)
excluded = [sol.rhs() for sol in dom_excl]
print("1. DOMINIO: esclusi x tali che denominatore = 0 →", dom_excl)
print("   Dominio: R \\ {", excluded, "}")
print()

# 2. SIMMETRIE
print("2. SIMMETRIE:")
print("   f(-x) =", f(-x).simplify())
print("   -f(-x) =", (-f(-x)).simplify())
print("   → Né pari né dispari (nessuna simmetria evidente)")
print()

# 3. ZERI (intersezioni con asse x)
num = x^3 - 2*x^2 + 1
zeri_num = solve(num == 0, x)
print("3. ZERI (f(x)=0):", zeri_num)
print()

# 4. SEGNO (studio del segno)
print("4. SEGNO:")
print("   Numeratore:", num.factor())
print("   Denominatore:", den.factor())
print("   Segno: si analizza il prodotto dei segni di num e den")
print()

# 5. LIMITI
print("5. LIMITI:")
l_inf = limit(f(x), x, -infinity)
l_pinf = limit(f(x), x, +infinity)
print("   lim x→-∞ f(x) =", l_inf)
print("   lim x→+∞ f(x) =", l_pinf)

for a in excluded:
    l_sx = limit(f(x), x, a, dir='minus')
    l_dx = limit(f(x), x, a, dir='plus')
    print(f"   lim x→{a}⁻ f(x) = {l_sx}")
    print(f"   lim x→{a}⁺ f(x) = {l_dx}")
print()

# 6. ASINTOTI
print("6. ASINTOTI:")
if l_pinf != infinity and l_pinf != -infinity:
    print("   Asintoto orizzontale a +∞: y =", l_pinf)
else:
    m = limit(f(x)/x, x, +infinity)
    q = limit(f(x) - m*x, x, +infinity)
    print(f"   Asintoto obliquo a +∞: y = {m}x + {q}")
if l_inf != infinity and l_inf != -infinity:
    print("   Asintoto orizzontale a -∞: y =", l_inf)
else:
    m = limit(f(x)/x, x, -infinity)
    q = limit(f(x) - m*x, x, -infinity)
    print(f"   Asintoto obliquo a -∞: y = {m}x + {q}")
for a in excluded:
    print(f"   Asintoto verticale: x = {a}")
print()

# 7. DERIVATA PRIMA (semplificata razionalmente)
print("7. DERIVATA PRIMA:")
df = diff(f(x), x)
df_simpl = df.simplify_rational()
print("   f'(x) =", df_simpl)
print()

# 8. MONOTONIA
print("8. MONOTONIA:")
critici = solve(df_simpl == 0, x)
print("   Punti critici (f'(x)=0):", critici)
print()

# 9. DERIVATA SECONDA (semplificata razionalmente)
print("9. DERIVATA SECONDA:")
ddf = diff(f(x), x, 2)
ddf_simpl = ddf.simplify_rational()
print("   f''(x) =", ddf_simpl)
print()

# 10. CONCAVITÀ E FLESSI
print("10. CONCAVITÀ E PUNTI DI FLESSO:")
flessi = solve(ddf_simpl == 0, x)
print("    Punti candidati flesso (f''(x)=0):", flessi)
print()

# 11. GRAFICO
print("11. GRAFICO:")
for sol in critici:
    xc = sol.rhs()
    if xc in excluded:
        print(f"    Punto critico x={xc} escluso dal dominio (asintoto/buco)")
    else:
        yc = f(xc)
        print(f"    Punto critico: ({xc}, {yc})")
for sol in flessi:
    xf = sol.rhs()
    if xf in excluded:
        print(f"    Punto di flesso candidato x={xf} escluso dal dominio")
    else:
        yf = f(xf)
        print(f"    Punto di flesso candidato: ({xf}, {yf})")
print()

# 12. DISEGNO
print("12. DISEGNO:")
P = plot(f, (x, -5, 5), ymin=-10, ymax=10, detect_poles='show',
         title='f(x) = (x^3 - 2x^2 + 1)/(x^2 - 3x + 2)',
         legend_label='f(x)', color='blue')

for a in excluded:
    P += line([(a, -10), (a, 10)], linestyle='dashed', color='red')

m_pinf = limit(f(x)/x, x, +infinity)
q_pinf = limit(f(x) - m_pinf*x, x, +infinity)
if m_pinf != 0 and m_pinf != infinity and m_pinf != -infinity:
    P += plot(m_pinf*x + q_pinf, (x, -5, 5), color='green', linestyle='dashed',
              legend_label='asintoto obliquo +∞')

m_ninf = limit(f(x)/x, x, -infinity)
q_ninf = limit(f(x) - m_ninf*x, x, -infinity)
if m_ninf != 0 and m_ninf != infinity and m_ninf != -infinity:
    P += plot(m_ninf*x + q_ninf, (x, -5, 5), color='orange', linestyle='dashed',
              legend_label='asintoto obliquo -∞')

P.save('grafico_funzione.png')
print("   Grafico salvato come 'grafico_funzione.png'")
print()

print("=== FINE STUDIO ===")
