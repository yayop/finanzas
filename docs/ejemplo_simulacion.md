# Ejercicio de funcionamiento con datos ficticios

**Todos los importes, fechas y tipos de cambio de este ejercicio son ficticios.** No representan las finanzas reales de la pareja, una cotización vigente ni el derecho o importe legal del chômage.

Este documento se genera con `python3 scripts/simular_ejemplo.py --markdown`. Presenta el caso de prueba que acompaña al simulador interactivo local, disponible al ejecutar `python3 scripts/servidor.py`.

## Supuestos del ejercicio

- Período: 2026-11 a 2027-10, ambos incluidos; cierre mensual y saldos iniciales anteriores al primer mes.
- Saldo inicial: él 3.000,00 EUR; ella 1.000,00 EUR; ambos parten con 0 CLP.
- Cada pago CLP se financia mediante una compra prevista de CLP con EUR al tipo explícito de su mes, sin comisiones. Los registros identifican pagador, moneda original e importe convertido.
- Los importes EUR internos son céntimos enteros; los CLP son pesos enteros. El redondeo mensual asigna el aporte de él al céntimo más próximo y a ella el resto, conservando el total; una mitad exacta se redondea alejándose de cero.
- Las facturas comienzan a pagarse en el mes configurado; aquí los meses de primera cuota están separados por dos meses. No se descuenta también el importe completo de cada factura.
- Cada cuota CLP se convierte y redondea una vez. Por ello la suma de sus equivalentes EUR puede diferir algún céntimo de convertir el agregado CLP una sola vez.

Tipo de cambio ficticio constante: **1 EUR = 1000 CLP**.

| Ingreso | Persona | Neto mensual EUR | Desde | Hasta | Extra |
| --- | --- | ---: | --- | --- | --- |
| sueldo_inicial | el | 2.600,00 | 2026-11 | 2026-12 | No |
| chomage | el | 1.500,00 | 2027-01 | 2027-03 | No |
| nuevo_sueldo | el | 2.400,00 | 2027-04 | 2027-10 | No |
| doctorado | ella | 1.800,00 | 2026-11 | 2027-10 | No |
| extra | ella | 300,00 | 2026-11 | 2027-10 | Sí |

La fuente denominada chômage usa un importe supuesto aportado al ejemplo. El escenario H sustituye esa fuente durante sus mismas fechas; no suma sueldo y prestación.

| Gasto EUR | Pagador | Carácter | Mensual EUR | Desde | Hasta |
| --- | --- | --- | ---: | --- | --- |
| hogar | el | comun | 1.500,00 | 2026-11 | 2027-10 |
| propios_el | el | personal | 200,00 | 2026-11 | 2027-10 |
| propios_ella | ella | personal | 150,00 | 2026-11 | 2027-10 |

- Deuda fija de ella: 46 cuotas totales; 6 ya pagadas; 40 por pagar desde 2026-11; cuota de 200.000 CLP. No se infiere capital ni interés a partir de las cuotas.
- Ayuda personal a la hermana: ella paga 300.000 CLP cada mes, de 2026-11 a 2027-03, **incluido el último mes**.

| Factura | Titular y pagador | Importe CLP | Primera cuota | Cuotas base |
| --- | --- | ---: | --- | ---: |
| universidad_1 | ella | 720.000 | 2026-11 | 12 |
| universidad_2 | ella | 960.000 | 2027-01 | 12 |
| universidad_3 | ella | 1.200.000 | 2027-03 | 12 |
| universidad_4 | ella | 1.440.000 | 2027-05 | 12 |

## Escenarios comparados

| Id | Acuerdo |
| --- | --- |
| A | Comunes 50/50; deudas personales |
| B | Comunes y universidad 50/50 |
| C | Proporcional incluyendo extras |
| D | Proporcional excluyendo extras |
| E | Igualar todo el flujo libre |
| F | Igualar margen preservando extras |
| G | 50/50 con universidad en 6 cuotas |
| H | 50/50 manteniendo empleo en enero a marzo |

A-F conservan ingresos y pagos externos: cambia quién asume sus costos. En B ella sigue pagando a la universidad y la parte compartida entra una sola vez al reparto. G adelanta pagos universitarios; H cambia los ingresos de enero a marzo.

En la regla proporcional se usan los ingresos considerados, sin descontar obligaciones personales. Para igualar disponibilidad considerada se define `D = ingresos considerados − pagos personales` y `aporte de él = (comunes + D de él − D de ella) / 2`. Un aporte negativo es posible y representa apoyo adicional entre ambos.

Excluir extras cambia únicamente la base del acuerdo: esos ingresos siempre llegan al saldo. E iguala el flujo libre real; F iguala el margen calculado sin los extras y protege esos ingresos. Esto no iguala los saldos acumulados iniciales.

Aunque una deuda conserve su titular y pago personal, descontarla antes de igualar disponibilidades cambia los aportes comunes. Por tanto, esa regla redistribuye indirectamente su efecto económico entre ambos; debe ser un acuerdo consciente.

## Un mes explicado

Escenario A, 2026-11. En los datos él paga los gastos del hogar a terceros; cada uno paga sus conceptos personales. La compensación ajusta quién termina asumiendo el costo del acuerdo. Recibir una compensación no crea un nuevo ingreso para el hogar.

| Concepto EUR | Él | Ella |
| --- | ---: | ---: |
| Ingresos recibidos | 2.600,00 | 2.100,00 |
| Pagado a terceros | 1.700,00 | 710,00 |
| Costo asumido: personal + común asignado | 950,00 | 1.460,00 |
| Compensación neta: recibido menos enviado | 750,00 | −750,00 |
| Flujo libre del mes | 1.650,00 | 640,00 |
| Saldo inicial | 3.000,00 | 1.000,00 |
| Saldo final | 4.650,00 | 1.640,00 |

`Flujo libre = ingresos − pagos a terceros + compensación = ingresos − costo asumido`. Las compensaciones de ambos suman cero.

## Comparación de meses representativos

Cada celda muestra **flujo libre de él / flujo libre de ella**, en EUR, antes de reservar ahorro.

| Escenario | 2026-11 | 2027-01 | 2027-03 | 2027-04 |
| --- | ---: | ---: | ---: | ---: |
| A | 1.650,00 / 640,00 | 550,00 / 560,00 | 550,00 / 460,00 | 1.450,00 / 760,00 |
| B | 1.620,00 / 670,00 | 480,00 / 630,00 | 430,00 / 580,00 | 1.330,00 / 880,00 |
| C | 1.570,21 / 719,79 | 675,00 / 435,00 | 675,00 / 335,00 | 1.400,00 / 810,00 |
| D | 1.513,64 / 776,36 | 618,18 / 491,82 | 618,18 / 391,82 | 1.342,86 / 867,14 |
| E | 1.145,00 / 1.145,00 | 555,00 / 555,00 | 505,00 / 505,00 | 1.105,00 / 1.105,00 |
| F | 995,00 / 1.295,00 | 405,00 / 705,00 | 355,00 / 655,00 | 955,00 / 1.255,00 |
| G | 1.650,00 / 580,00 | 550,00 / 420,00 | 550,00 / 220,00 | 1.450,00 / 520,00 |
| H | 1.650,00 / 640,00 | 1.650,00 / 560,00 | 1.650,00 / 460,00 | 1.450,00 / 760,00 |

## Recorrido mensual del escenario A

Importes en EUR salvo universidad y ayuda, que se muestran en CLP. La compensación de él es **positiva si recibe** dinero; la de ella tiene igual importe y signo contrario. La deuda fija se incluye en los pagos y flujos, aunque no tiene columna propia.

| Mes | Ingreso él | Ingreso ella | Univ. CLP | Ayuda CLP | Comp. él | Libre él | Libre ella | Saldo él | Saldo ella |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-11 | 2.600,00 | 2.100,00 | 60.000 | 300.000 | 750,00 | 1.650,00 | 640,00 | 4.650,00 | 1.640,00 |
| 2026-12 | 2.600,00 | 2.100,00 | 60.000 | 300.000 | 750,00 | 1.650,00 | 640,00 | 6.300,00 | 2.280,00 |
| 2027-01 | 1.500,00 | 2.100,00 | 140.000 | 300.000 | 750,00 | 550,00 | 560,00 | 6.850,00 | 2.840,00 |
| 2027-02 | 1.500,00 | 2.100,00 | 140.000 | 300.000 | 750,00 | 550,00 | 560,00 | 7.400,00 | 3.400,00 |
| 2027-03 | 1.500,00 | 2.100,00 | 240.000 | 300.000 | 750,00 | 550,00 | 460,00 | 7.950,00 | 3.860,00 |
| 2027-04 | 2.400,00 | 2.100,00 | 240.000 | 0 | 750,00 | 1.450,00 | 760,00 | 9.400,00 | 4.620,00 |
| 2027-05 | 2.400,00 | 2.100,00 | 360.000 | 0 | 750,00 | 1.450,00 | 640,00 | 10.850,00 | 5.260,00 |
| 2027-06 | 2.400,00 | 2.100,00 | 360.000 | 0 | 750,00 | 1.450,00 | 640,00 | 12.300,00 | 5.900,00 |
| 2027-07 | 2.400,00 | 2.100,00 | 360.000 | 0 | 750,00 | 1.450,00 | 640,00 | 13.750,00 | 6.540,00 |
| 2027-08 | 2.400,00 | 2.100,00 | 360.000 | 0 | 750,00 | 1.450,00 | 640,00 | 15.200,00 | 7.180,00 |
| 2027-09 | 2.400,00 | 2.100,00 | 360.000 | 0 | 750,00 | 1.450,00 | 640,00 | 16.650,00 | 7.820,00 |
| 2027-10 | 2.400,00 | 2.100,00 | 360.000 | 0 | 750,00 | 1.450,00 | 640,00 | 18.100,00 | 8.460,00 |

## Cierre y obligaciones posteriores al horizonte

| Escenario | Saldo él EUR | Saldo ella EUR | Saldo hogar EUR | Universidad pagada CLP | Universidad futura CLP | Cuotas fijas futuras | Suma nominal fija futura CLP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 18.100,00 | 8.460,00 | 26.560,00 | 3.040.000 | 1.280.000 | 28 | 5.600.000 |
| B | 16.580,00 | 9.980,00 | 26.560,00 | 3.040.000 | 1.280.000 | 28 | 5.600.000 |
| C | 17.965,42 | 8.594,58 | 26.560,00 | 3.040.000 | 1.280.000 | 28 | 5.600.000 |
| D | 17.281,84 | 9.278,16 | 26.560,00 | 3.040.000 | 1.280.000 | 28 | 5.600.000 |
| E | 14.280,00 | 12.280,00 | 26.560,00 | 3.040.000 | 1.280.000 | 28 | 5.600.000 |
| F | 12.480,00 | 14.080,00 | 26.560,00 | 3.040.000 | 1.280.000 | 28 | 5.600.000 |
| G | 18.100,00 | 7.180,00 | 25.280,00 | 4.320.000 | 0 | 28 | 5.600.000 |
| H | 21.400,00 | 8.460,00 | 29.860,00 | 3.040.000 | 1.280.000 | 28 | 5.600.000 |

En A: ingresos del hogar 51.700,00 EUR; pagos a terceros 29.140,00 EUR; flujo libre acumulado 22.560,00 EUR; saldo inicial 4.000,00 EUR y saldo final 26.560,00 EUR. Las transferencias entre ustedes se cancelan al sumar el hogar.

## Qué permite comprobar y qué queda pendiente

- Cambiar el reparto redistribuye el dinero libre individual. No crea recursos para el hogar. Un aporte negativo bajo la regla de igualdad exige una transferencia adicional y podría consumir saldos previos.
- Pagar en menos cuotas cambia el calendario: un cierre menor puede acompañarse de menos obligaciones futuras. La suma de cuotas fijas pendientes es un compromiso nominal, **no capital pendiente**. Los compromisos futuros permanecen en CLP; no se les aplica una cotización futura inventada.
- Los saldos acumulan cada flujo mensual. Un flujo negativo consume saldo previo; un saldo final negativo marca necesidad de financiación, sin agregar crédito automático. La igualdad de flujo puede diferir en un céntimo cuando el total no admite división exacta.
- Este es flujo libre **antes de ahorro**: todavía no se modelan reservas, metas ni aportes posibles de ahorro. El saldo acumulado no es una recomendación de cuánto gastar: quedan compromisos posteriores al horizonte. Un saldo positivo tampoco garantiza liquidez antes de cada vencimiento dentro del mes.
- El saldo en EUR de esta maqueta combina efectivo inicial y compras previstas de CLP. No sustituye la futura contabilidad de cuentas reales por moneda, comisiones ni conversiones efectivamente realizadas; una equivalencia de presentación por sí sola no compra CLP.
- El ejemplo no estima derechos, importes legales ni fechas reales del chômage, intereses o capital de la deuda. Todos los ingresos, las tasas de cambio y las fechas deben reemplazarse por datos confirmados antes de usar el futuro producto para decisiones personales.
