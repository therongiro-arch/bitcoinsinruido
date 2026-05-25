# ₿ Bitcoin Sin Ruido — Contexto técnico

> Archivo de referencia extraído de la wiki. Sin precio, sin hype, solo protocolo.

---

## 1. Fundamentos del protocolo

### UTXOs — Monedas, no saldos

Bitcoin **no** es una base de datos de saldos. Es una base de datos de **UTXOs** (Unspent Transaction Outputs): monedas digitales específicas que solo el receptor puede gastar.

- Cuando recibes Bitcoin no te "acreditan" nada — recibes una moneda que solo tú puedes mover.
- Cuando envías BTC, gastas una moneda concreta y recibes el cambio, igual que con billetes físicos.
- Este diseño hace al sistema más privado y más verificable.

### Proof of Work

Los mineros compiten para encontrar un número aleatorio que, combinado con las transacciones, produzca un hash con características específicas. Es costoso a propósito.

- El **costo físico** (energía) es la seguridad: reescribir el historial requeriría más electricidad que la que consumen países enteros.
- No hay banco central que proteja Bitcoin — lo protege la energía gastada.

### Los 21 millones

No es una promesa — es **código matemático**:

- Cada ~4 años la recompensa de minería se reduce a la mitad (**halving**).
- La suma de esa serie geométrica converge exactamente en 21.000.000 BTC.
- Ningún CEO puede cambiarlo. Ningún gobierno puede imprimirlos.

### Nodos — Los verdaderos guardianes

Un nodo es una computadora que guarda copia completa de Bitcoin y verifica cada transacción según las reglas del protocolo.

- Hay ~20.000 nodos activos en el mundo.
- Si un minero viola las reglas, los nodos lo rechazan automáticamente, sin votación.
- **El poder real no está en quien tiene más hashrate — está en los nodos.**

---

## 2. Mapa de mejoras del protocolo (estado 2026)

| Capa | Qué mejora | Estado |
|---|---|---|
| Protocolo base | Covenants (OP_CAT, CTV) | Debate activo, posible 2026 |
| Privacidad | Taproot + firmas Schnorr | Implementado |
| Escalabilidad L2 | Lightning + splicing | Madurando rápido |
| Programabilidad | BitVM / ZK-rollups | Mainnet enero 2026 |
| Activos sobre BTC | Taproot Assets | En despliegue |
| Seguridad futura | BIP-360 cuántica | Testnet activo |

---

## 3. Taproot

Mejora activada en **2021**. Introduce firmas Schnorr que permiten transacciones más pequeñas, más privadas y más baratas. Considerada la mejora más importante de Bitcoin de los últimos años — y la menos comprendida por el público general.

---

## 4. Lightning Network (L2)

Capa 2 sobre Bitcoin para pagos instantáneos y baratos mediante canales de pago.

- **Cash App** registró un crecimiento de **7x** en uso de Lightning durante 2024.
- El **channel splicing** ya está implementado en todos los clientes principales: LDK, Eclair y c-lightning.

---

## 5. BitVM — Lo más importante de 2026

Permite ejecutar **computación arbitraria verificable** sobre Bitcoin sin modificar las reglas de consenso.

- **Citrea**, el primer ZK-rollup de Bitcoin, lanzó su mainnet el **27 de enero de 2026**.
- Abre la puerta a contratos inteligentes en Bitcoin sin un soft fork.

---

## 6. Covenants

Mejoras propuestas (OP_CAT, CTV) que permitirían poner **condiciones sobre cómo se puede gastar Bitcoin** en el futuro. Debate activo en la comunidad — posible activación en 2026.

---

## 7. Taproot Assets

Permite emitir stablecoins y activos reales directamente **sobre Lightning Network**. En despliegue activo.

---

## 8. Resistencia cuántica (BIP-360)

- **BIP-360** fue integrado al repositorio oficial en **febrero de 2026**.
- Aproximadamente **6,51 millones de BTC** (32,7% del suministro) están en direcciones vulnerables a un ataque cuántico.
- La transición completa tomaría entre **5 y 10 años**.
- Estado actual: **testnet activo**.

---

## 9. Glosario esencial

| Término | Definición |
|---|---|
| **UTXO** | Unspent Transaction Output. Moneda digital específica. Bitcoin no tiene saldos, tiene monedas. |
| **Proof of Work** | Consenso donde los mineros gastan energía real. El costo físico es la seguridad. |
| **Nodo** | Computadora con copia completa de Bitcoin que verifica cada transacción. ~20.000 activos. |
| **Halving** | Reducción a la mitad de la recompensa de minería cada ~4 años. Garantiza el límite de 21M BTC. |
| **Taproot** | Mejora de 2021. Introduce firmas Schnorr: transacciones más pequeñas, privadas y baratas. |
| **Lightning Network** | Capa 2 para pagos instantáneos y baratos mediante canales de pago. |
| **BitVM** | Sistema que permite contratos inteligentes en Bitcoin sin modificar el protocolo base. |
| **Covenants** | Mejoras propuestas para poner condiciones sobre cómo se puede gastar Bitcoin en el futuro. |
| **BIP** | Bitcoin Improvement Proposal. Documento formal para proponer cambios al protocolo. |
| **Soft fork** | Actualización retrocompatible del protocolo. Los nodos antiguos siguen funcionando. |
| **ZK-rollup** | Agrupa muchas transacciones y las verifica con una prueba matemática compacta. |
| **BIP-360** | Propuesta de resistencia cuántica. En testnet desde febrero 2026. |

---

## 10. Fuentes de investigación recomendadas

- [bitcoinops.org](https://bitcoinops.org) — Bitcoin Optech Newsletter (la más rigurosa)
- Bitcoin Magazine — sección Technical
- Bitcoin-dev mailing list — donde los devs debaten cambios
- [hiro.so/blog](https://hiro.so/blog) — estado de capas sobre Bitcoin
- [chaincode.com](https://chaincode.com) — research académico sobre el protocolo

---

*Extraído de la wiki Bitcoin Sin Ruido · Mayo 2026*
