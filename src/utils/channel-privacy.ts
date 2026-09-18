/**
 * Channel privacy classification for Linked Channels.
 *
 * Over HTTP, Discord's Social SDK `GuildChannel.isLinkable` and
 * `isViewableAndWriteableByAllMembers` fields DO NOT exist — they are only
 * available on Social SDK client handles (e.g. `Client::GetGuildChannels`).
 * So when building the channel list server-side from the REST API, privacy
 * has to be *derived* from the channel's `permission_overwrites`.
 *
 * Rule (fail-safe): a channel is private unless it is PROVABLY public.
 * Anything we cannot evaluate — role-specific or member-specific overwrites,
 * missing data — is treated as UNKNOWN, and the caller must warn.
 */

import { ChannelType, MiniPermFlags } from "@minesa-org/mini-interaction";

/** Discord permission overwrite type: 0 = role, 1 = member. */
const OVERWRITE_TYPE_ROLE = 0;
const OVERWRITE_TYPE_MEMBER = 1;

/** Minimal structural shape of an API channel overwrite. Declared locally
 * instead of importing from `discord-api-types/v10`, which is not a direct
 * dependency of this app (npm only hoists a transitive copy).
 */
export type ChannelOverwrite = {
	id: string;
	type: number;
	/** Permissions explicitly allowed by this overwrite (string bitfield). */
	allow?: string;
	/** Permissions explicitly denied by this overwrite (string bitfield). */
	deny?: string;
};

/** Minimal structural subset of an API guild channel used for classification. */
export type ClassifiableChannel = {
	id?: string;
	type?: number;
	permission_overwrites?: ChannelOverwrite[];
};

export type ChannelPrivacy = "public" | "private" | "unknown";

/** VIEW_CHANNEL | SEND_MESSAGES — the two perms that decide "read AND post". */
const READ_WRITE_MASK = MiniPermFlags.ViewChannel | MiniPermFlags.SendMessages;

function hasBit(bitfield: string | undefined, mask: bigint): boolean | undefined {
	if (bitfield === undefined || bitfield === null) return undefined;
	try {
		return (BigInt(bitfield) & mask) === mask;
	} catch {
		return undefined;
	}
}

/**
 * Classify a single `@everyone` role overwrite (type 0 whose id equals the
 * guild id) against the read/write mask.
 */
export function classifyEveryoneOverwrite(
	overwrite: ChannelOverwrite | undefined,
	guildId: string,
): ChannelPrivacy {
	if (!overwrite || overwrite.type !== OVERWRITE_TYPE_ROLE || overwrite.id !== guildId) {
		return "unknown";
	}

	const deniedView = hasBit(overwrite.deny, MiniPermFlags.ViewChannel);
	const deniedSend = hasBit(overwrite.deny, MiniPermFlags.SendMessages);

	if (deniedView === true || deniedSend === true) return "private";

	const allowedView = hasBit(overwrite.allow, MiniPermFlags.ViewChannel);
	const allowedSend = hasBit(overwrite.allow, MiniPermFlags.SendMessages);

	if (allowedView === true && allowedSend === true) return "public";

	return "unknown";
}

/**
 * Does any role/member overwrite explicitly deny VIEW_CHANNEL or
 * SEND_MESSAGES? Such a deny means at least someone in the server is
 * locked out, so the channel cannot be considered provably public.
 */
export function hasRestrictiveOverwrites(
	overwrites: ChannelOverwrite[] | undefined,
): boolean {
	if (!Array.isArray(overwrites)) return false;
	return overwrites.some((overwrite) => {
		if (overwrite.type !== OVERWRITE_TYPE_ROLE && overwrite.type !== OVERWRITE_TYPE_MEMBER) {
			return false;
		}
		const deniedView = hasBit(overwrite.deny, MiniPermFlags.ViewChannel);
		const deniedSend = hasBit(overwrite.deny, MiniPermFlags.SendMessages);
		return deniedView === true || deniedSend === true;
	});
}

/**
 * Pure, unit-testable privacy classifier.
 *
 * - No overwrites at all -> public (defaults apply: everyone can read/write).
 * - `@everyone` overwrite denying VIEW_CHANNEL or SEND_MESSAGES -> private.
 * - Any role/member overwrite denying read/write -> cannot prove public.
 * - Everything else (incl. unevaluable overwrites) -> unknown.
 *
 * Callers must treat anything that is not "public" as needing the
 * private-channel warning ("warn unless provably public").
 */
export function classifyChannelPrivacy(
	channel: ClassifiableChannel | undefined,
	guildId: string,
): ChannelPrivacy {
	if (!channel) return "unknown";

	// Only guild text channels are linkable targets worth classifying.
	if (channel.type !== undefined && channel.type !== ChannelType.GuildText) {
		return "unknown";
	}

	const overwrites = channel.permission_overwrites;

	// No overwrite data at all -> default permissions, provably public.
	if (!Array.isArray(overwrites)) {
		return channel.type === ChannelType.GuildText ? "public" : "unknown";
	}

	// Restrictive role/member overwrites: we cannot evaluate who they grant or
	// deny access to, so the channel is not PROVABLY public.
	if (hasRestrictiveOverwrites(overwrites)) return "private";

	const everyone = overwrites.find(
		(overwrite) => overwrite.type === OVERWRITE_TYPE_ROLE && overwrite.id === guildId,
	);
	// role overwrites only exist as @everyone here (restrictive ones already
	// returned private above) — classify the @everyone entry.
	if (everyone) return classifyEveryoneOverwrite(everyone, guildId);

	// No @everyone overwrite and no restrictive overwrites -> defaults apply.
	return "public";
}
