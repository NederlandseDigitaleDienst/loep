-- Gives keyboard focus to the web content of Safari's front window, so that VoiceOver's
-- cursor (which follows keyboard focus) lands in the page and not in the address bar.
-- Returns the role description of the focused element.
tell application "Safari" to activate
delay 0.5
tell application "System Events"
	tell process "Safari"
		set found to missing value
		set queue to {window 1}
		repeat while (count of queue) > 0 and found is missing value
			set current to item 1 of queue
			set queue to rest of queue
			try
				repeat with child in (UI elements of current)
					if role of child is "AXWebArea" then
						set found to contents of child
						exit repeat
					end if
					set end of queue to contents of child
				end repeat
			end try
		end repeat
		if found is missing value then return "no web area found"
		set focused of found to true
		delay 0.5
		return "focused web area: " & (value of attribute "AXFocused" of found as text)
	end tell
end tell
